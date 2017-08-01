let temp_title = "testproject" + Math.floor(Math.random() * 200)

let CONFIGURATION_USER = {
  "authentication": {
    "fogbugz": {
      "url": "http://support.jonar.com/support/",
      "user": "justin@jonar.com",
      "password": "jamila"
    },
    "gitlab": {
      "token": "LzWPyuuiPnmkCzjD_Fbs"
    }
  },
  "gitlab_project": {
    "name": temp_title,
    "description": "boring description",
    "exclude_creation": {
      "categories": ['Task'] // Add default empty string for this
    },
    "exclude_assignment": {
      "milestone":['Undecided']
    },
    active_milestones: [
      "Sprint 100",
      "Short-Term Product Backlog",
      "Product Backlog",
      "Special Projects Backlog"
    ],
    "issued_enabled": true
  },
  "fogbugz_project": {
    // "name": "R&D",
    "name": "Side Projects",
    "custom_fields": [
      {
        display_name: 'Points ${self}',
        fogbugz_field: 'storyxpoints'
      }, 
      {
        display_name: 'Next Sprint',
        fogbugz_field: 'nextxsprint'
      },
      {
        display_name: 'Next Poker',
        fogbugz_field: 'nextxpoker'
      }
    ]
  }
}

const CONFIGURATION_DEFAULT = {
  authentication: CONFIGURATION_USER.authentication,
  gitlab_project: {
    name: CONFIGURATION_USER.gitlab_project.name || 'New Gitlab Project',
    description: CONFIGURATION_USER.gitlab_project.description || 'My Gitlab Project',
    issues_enabled: CONFIGURATION_USER.gitlab_project.issues_enabled || true,
    merge_requests_enabled: CONFIGURATION_USER.gitlab_project.merge_requests_enabled || true,
    wiki_enabled: CONFIGURATION_USER.gitlab_project.wiki_enabled || false,
    active_milestones: CONFIGURATION_USER.gitlab_project.active_milestones || [],
    exclude_assignment: CONFIGURATION_USER.gitlab_project.exclude_assignment || {},
    exclude_creation: CONFIGURATION_USER.gitlab_project.exclude_creation || {}
  },
  fogbugz_project: {
    name: CONFIGURATION_USER.fogbugz_project.name,
    custom_fields: CONFIGURATION_USER.fogbugz_project.custom_fields || [],
  }
}

const FogbugzJS = require('../fogbugz.js');
const Promise = require('bluebird');
const Gitlab = require('../node-gitlab-api');
const Tempy = require('tempy');
const Path = require('path');
const Request = require('request');
const Fs = require('fs');

let FogbugzAPI;
let GitlabAPI;

/*---------------------------------- Cache ----------------------------------*/
// All Fogbugs Users
let FBUsers = [];

// Cached GitLab User
let AdminUser;

// Cached GitLab Labels
let GLLabels = [];

// Cached GitLab Milestones
let GLMilestones = [];

// Cached GitLab issues_enabled
let GLIssues = [];

// Cached GitLab projects
let GLProject;

/*--------------------------------- Import ----------------------------------*/

try {
  initAPIandCache()
  .then(importProject)
  .then(closeMilestones)
}catch(e){
  console.log(e);
}


/*--------------------------------- Helper ----------------------------------*/

async function importProject() {

  // Create the GL Project
  await GitlabAPI.projects.create({
    name: CONFIGURATION_DEFAULT.gitlab_project.name,
    description: CONFIGURATION_DEFAULT.gitlab_project.description,
    issues_enabled: CONFIGURATION_DEFAULT.gitlab_project.issues_enabled,
    merge_requests_enabled: CONFIGURATION_DEFAULT.gitlab_project.merge_requests_enabled,
    wiki_enabled: CONFIGURATION_DEFAULT.gitlab_project.wiki_enabled,
  })

  // Set GLProject
  GLProject = await GitlabAPI.projects.show(`${AdminUser.username}/${CONFIGURATION_USER.gitlab_project.name}`);

  // Populate Caches for testing purposes
  await populateCache()

  //Get the cases from FB for the FB Project being imported
  let baseQueryString = `project:"${CONFIGURATION_DEFAULT.fogbugz_project.name}"`;

  // //Exclude certain categories
  if(CONFIGURATION_DEFAULT.gitlab_project.exclude_creation.categories){
    CONFIGURATION_DEFAULT.gitlab_project.exclude_creation.categories.forEach(category => {
      baseQueryString += `category:"${category}"`;
    })
  }

  baseQueryString += `orderby:"case"`;
  baseQueryString += 'parent:0';

  //Paginate
  let moreToProcess = true;
  let processDate = new Date(Date.now()).toLocaleDateString("en-US");
  let caseNumber = "0";

  while (moreToProcess) {
    let queryString = `case:"115754"`;
    let cases = await FogbugzAPI.search(queryString, 100, false);

    for (data of cases) {
      await processCase(data);
    }

    caseNumber = cases[cases.length - 1].id + 1
    // moreToProcess = (cases.length < 100) ? false : true;
    moreToProcess = false;
  }
}

async function processCase(data, parentId) {
  let gitlabChildren = [];
  let issue = await importCase(data, parentId);

  if (data.children.length) {
    let childrenQuery = data.children.map((id) => `case:"${id}"`).join(' OR ');
    let children = await FogbugzAPI.search(childrenQuery, 100, false);

    for (child of children) {
      let glChild = await processCase(child, issue.iid);
      
      gitlabChildren.push(glChild);
    }

    // FIXME: Just inject updated description instead of rebuilding
    let content = getOpenedComment(data.events);
    let body = formatIssueBody(data, content, parentId, gitlabChildren);

    await GitlabAPI.projects.issues.edit(GLProject.id, issue.iid, {
      description: body
    });
  }

  return issue;
}

async function initAPIandCache() {
  fogbugsConfig = Object.assign({}, CONFIGURATION_DEFAULT.authentication.fogbugz);
  fogbugsConfig.customFields = CONFIGURATION_DEFAULT.fogbugz_project.custom_fields;

  FogbugzAPI = await FogbugzJS(fogbugsConfig);
  GitlabAPI = await Gitlab(CONFIGURATION_DEFAULT.authentication.gitlab);
  FBUsers = await getAllFogbugzUsers();
  AdminUser = await GitlabAPI.users.current();
}

async function getAllFogbugzUsers() {
  let users = await FogbugzAPI.users();

  return users.filter(user => { return user.deleted === false });
}

async function importCase(data, parentId) {
  let labels = await buildLabels(data);
  let labelInfo = [data.category.name];
  let author = AdminUser.username
  let date = data.opened;
  let comments = data.events;
  let content = getOpenedComment(comments);
  let body = formatIssueBody(data, content, parentId);
  let milestone = await getMilestone(data.milestone); 

  let issue = GLIssues.find(Issue => Issue.title.trim() === data.title.trim());

  if (!issue) {
    issue = await GitlabAPI.projects.issues.create(GLProject.id, {
      title: data.title,
      description: body,
      author_id: author,
      state: data.isOpen == 'true' ? 'opened' : 'closed',
      milestone_id: CONFIGURATION_DEFAULT.gitlab_project.exclude_assignment.milestone.includes(milestone.name) ? undefined : milestone.id,
      created_at: date.toDateString(),
      updated_at: data.lastUpdated,
      labels: labels.map(label => label.name).join(','),
      weight: data.priority.id
    });

    for (comment of comments) {
      if (!comment.text) continue
      await importIssueComment(issue.iid, comment)
    }

    if(!data.isOpen){
      issue = await GitlabAPI.projects.issues.edit(GLProject.id, issue.iid, {
        state_event: 'close',
      });
    }

    // Populate Cache
    GLIssues.push(issue);
  }

  return issue;
}

async function populateCache() { 
  GLLabels = await GitlabAPI.labels.all(GLProject.id);
  GLMilestones = await GitlabAPI.projects.milestones.all(GLProject.id);
  GLIssues = await GitlabAPI.projects.issues.all(GLProject.id)
}

async function buildLabels(data) {
  let labelList = []

  // Process Tags as Labels
  if (data.tags.length) {
    for (tag of data.tags) {
      labelList.push(await getLabel(tag))
    }
  }

  // Process Category as labels
  labelList.push(await getLabel(data.category.name))

  // Process Custom Fields as labels
  for (customField of CONFIGURATION_USER.fogbugz_project.custom_fields){
    labelList.push(await getLabel(processCustomField(customField,data)))
  }

  return labelList
}

function processCustomField(customField, data){
  console.log(data[customField.fogbugz_field])
  return customField.display_name.replace('${self}', data[customField.fogbugz_field])
}

async function importIssueComment(issueId, comment) {
  let author = comment.person.name
  let content = formatContent(comment.html)
  let date = comment.date.toDateString()

  if (!content) return;

  let body = await formatIssueCommentBody(author, date, content, comment.attachments)

  await GitlabAPI.projects.issues.notes.create(GLProject.id, issueId, {
    created_at: date,
    body: body
  });
}

async function getLabel(fogbugzLabelName) {
  let cleanedFogbugzLabel = pascaleCase(fogbugzLabelName)
  let label = GLLabels.find(label => label.name === cleanedFogbugzLabel);

  if (!label) {
    let glLabel = await GitlabAPI.labels.create(GLProject.id, {
      name: cleanedFogbugzLabel,
      color: labelColours(cleanedFogbugzLabel)
    });

    GLLabels.push(glLabel);

    label = glLabel;
  }

  return label;
}

async function getMilestone(fogbugzMilestone) {
  let milestone = GLMilestones.find(milestone => milestone.title === fogbugzMilestone.name);

  if (!milestone) {
    let GLMilestone = await GitlabAPI.projects.milestones.add(GLProject.id, fogbugzMilestone.name, {
      due_date: fogbugzMilestone.end.toDateString()
    });

    GLMilestones.push(GLMilestone);

    milestone = GLMilestone;
  }

  return milestone;
}

async function closeMilestones() {
  const activeMilestones = CONFIGURATION_DEFAULT.gitlab_project.active_milestones

  for (milestone of GLMilestones) {
    if (activeMilestones.indexOf(milestone) == -1) {
      await GitlabAPI.projects.milestones.update(GLProject.id, milestone.id, { state_event: "close" })
    }
  }
}

function getOpenedComment(comments) {
  return comments.find((comment) =>
    comment.verb === "Opened"
  )
}

function formatContent(content) {
  if (!content) return '';

  return linkifyIssues(escapeMarkdown(content))
}

function formatIssueBody(data, content = {}, parentId, childIssues) {
  let caseNumber = data.id
  let author = content.description
  let date = data.opened.toDateString()
  let assignee = data.assignee.name
  let releaseNotes = data.releaseNotes

  let body = [];
  let header = `${author}` || 'Opened by unknown :confused:';

  body.push(`**${header}**`);

  if (parentId) body.push(`*Parent: #${parentId}*`);

  if (childIssues){
    let formatChildren = '';

    childIssues.forEach((child) => {
      let closed = child.state === 'closed'? 'x' : ' ';

      formatChildren+=`- [${closed}] [*#${child.iid} ${child.title}*](#${child.iid}) \n`
    })

    body.push(formatChildren);
  }

  if(!((assignee === 'Up For Grabs') || (assignee === 'CLOSED'))){
    body.push(`*Assigned to ${assignee}*`);
  }

  if (content.text || releaseNotes) body.push('---');
  if (content.text) body.push(formatContent(content.text));
  if (releaseNotes) body.push(`\n Release Notes: *${formatContent(content.text)}*`);

  return body.join("\n\n");
}

async function formatAttachment(attachment) {
  let url = buildAttachmentURL(attachment.url);
  let res

  let tempDirectory = Tempy.directory()
  let filePath = Path.join(tempDirectory, attachment.fileName)

  await new Promise((resolve, reject) => {
    Request.get({
        url,
        auth: {
          user: CONFIGURATION_DEFAULT.authentication.fogbugz.user,
          pass: CONFIGURATION_DEFAULT.authentication.fogbugz.password,
          sendImmediately: false
        }
      })
      .pipe(Fs.createWriteStream(filePath))
      .on('finish', (done) => {
        resolve();
      })
      .on('error', (error) => {
        reject(error);
      });
  })

  try {
    res = await GitlabAPI.projects.upload(GLProject.id, filePath)
  } catch (e) {
    console.log(e);
  }

  if (!res) return null;

  return res.markdown;
}

function buildAttachmentURL(url) {
  return `${CONFIGURATION_DEFAULT.authentication.fogbugz.url}/${url}&token=${FogbugzAPI.token}`
}

function formatUpdates(comment) {
  let updates = []

  if (comment.changes) updates.push(`*${linkifyIssues(escapeMarkdown(comment.changes.replace("\n", "")))}*`);

  return updates;
}

async function formatIssueCommentBody(author, date, content, attachments) {
  let body = [];

  body.push(`**By ${author} on ${date} (imported from FogBugz)**`);
  body.push('---');
  body.push(content);

  for (attachment of attachments) {
    body.push('---');
    body.push(await formatAttachment(attachment));
  }

  return body.join("\n\n");
}

function linkifyIssues(str) {
  str = str.replace(/([Ii]ssue) ([0-9]+)/, '\1 #\2');
  return str.replace(/([Cc]ase) ([0-9]+)/, '\1 #\2');
}

function escapeMarkdown(str) {
  str = str.replace(/^#/, "\\#")
  str = str.replace(/^-/, "\\-")
  str = str.replace("`", "\\~")
  str = str.replace("\r", "")

  return str.replace("\n", "  \n")
}

function pascaleCase(inputString) { 
  return inputString.replace(/(?:^\w|[A-Z]|\b\w)/g, function(letter, index) { 
      return letter.toUpperCase(); 
    }).replace(/\s+/g, ''); 
}

// TODO Make this configurable
function labelColours(name) {
  switch (name) {
    case 'Blocker':
      return '#ff0000';
    case 'Crash':
      return '#ffcfcf';
    case 'Major':
    case 'Epic':
      return '#deffcf';
    case 'Minor':
      return '#cfe9ff';
    case 'Bug':
      return '#F44336';
    case 'Feature':
      return '#4CAF50';
    case 'User Story':
      return '#3F51B5';
    case 'Technical Task':
      return '#4CAF50';
    case 'Technical Debt':
      return '#4b6dd0';
    case 'Research Spike':
      return '#009688';
    case 'Task':
      return '#2196F3'
    default:
      return '#e2e2e2';
  }
}