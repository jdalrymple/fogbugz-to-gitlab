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
    "issued_enabled": true
  },
  "fogbugz_project": {
    "name": "R&D",
    // "name": "Side Projects",
    "exclude": {
      "categories": ['Task'] // Add default empty string for this
    },
    "custom_fields": ['storyxpoints', 'nextxsprint', 'nextxpoker', ]
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
  },
  fogbugz_project: {
    name: CONFIGURATION_USER.fogbugz_project.name,
    exclude: {
      categories: CONFIGURATION_USER.fogbugz_project.exclude.categories || []
    },
    custom_fields: CONFIGURATION_USER.fogbugz_project.custom_fields || []
  }
}

const FogbugzJS = require('../fogbugz.js');
const Promise = require('bluebird');
const Gitlab = require('../node-gitlab-api');

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
} catch (e) {
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
  GLProject = await GitlabAPI.projects.show(AdminUser.username + "/" + CONFIGURATION_USER.gitlab_project.name);

  // Populate Caches for testing purposes
  await populateCache()

  //Get the cases from FB for the FB Project being imported
  let baseQueryString = `project:"${CONFIGURATION_DEFAULT.fogbugz_project.name}"`;

  // //Exclude certain categories
  CONFIGURATION_DEFAULT.fogbugz_project.exclude.categories.forEach(category => {
    baseQueryString += `category:"${category}"`;
  })

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
      try{
      await processCase(data);
    } catch(e){
      console.log(e)
    }
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
      let glChild;
      try {
        glChild = await processCase(child, issue.iid);
      } catch(e){
        console.log(e);
      }
      
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

  FogbugzAPI = await FogbugzJS(CONFIGURATION_DEFAULT.authentication.fogbugz);
  GitlabAPI = await Gitlab(CONFIGURATION_DEFAULT.authentication.gitlab);
  FBUsers = await getAllFogbugzUsers();
  AdminUser = await GitlabAPI.users.current();
}

async function getAllFogbugzUsers() {
  let users = await FogbugzAPI.users();

  return users.filter(user => { return user.deleted === false });
}

async function importCase(data, parentId) {
  let labels = []
  let labelInfo = [data.category.name];
  let author = AdminUser.username
  let date = data.opened;
  let comments = data.events;
  let content = getOpenedComment(comments);
  let body = formatIssueBody(data, content, parentId);

  // If post is up for grabs or whatever add a label showing that
  // if (labelCheck(data.assignee.name)) { labelInfo.push(data.assignee.name) }
  if (data.nextxsprint) labelInfo.push("Next Sprint")
  if (data.nextxpoker) labelInfo.push("Next Poker")
  if (data.storyxpoints) labelInfo.push("Points: " + data.storyxpoints)
  if (data.tags.length) {
    for (tag of data.tags) {
      labelInfo.push(tag)
    }
  }

  for (fogbugzLabel of labelInfo) {
    labels.push(await getLabel(fogbugzLabel));
  }

  let issue = GLIssues.find(Issue => Issue.title.trim() === data.title.trim());

  if (!issue) {
    issue = await GitlabAPI.projects.issues.create(GLProject.id, {
      title: data.title,
      description: body,
      author_id: author,
      // milestone_id: await getMilestone(data.milestone).id,
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
  let temp = await GitlabAPI.labels.all(GLProject.id);
  GLLabels = temp;
  temp = await GitlabAPI.projects.milestones.all(GLProject.id);
  GLMilestones = temp;
  temp = await GitlabAPI.projects.issues.all(GLProject.id);
  GLIssues = temp
}

async function importIssueComment(issueId, comment) {
  let author = comment.person.name
  let content = formatContent(comment.html)
  let date = comment.date.toDateString()
  // let attachments = formatAttachments(comment.attachments)

  // if (!content && !attachments.length) return;
  if (!content) return;

  let body = formatIssueCommentBody(author, date, content)

  await GitlabAPI.projects.issues.notes.create(GLProject.id, issueId, {
    created_at: date,
    body: body
  });
}

async function getLabel(fogbugsLabelName) {
  let label = GLLabels.find(label => label.name === fogbugsLabelName);

  if (!label) {
    let glLabel = await GitlabAPI.labels.create(GLProject.id, {
      name: fogbugsLabelName,
      color: labelColours(fogbugsLabelName)
    });

    GLLabels.push(glLabel);

    label = glLabel;
  }

  return label;
}

function labelCheck(info) {
  return (!((info === 'Up For Grabs') || (info === 'CLOSED')))
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
      let closed = child.state === 'closed'? 'x' : '';

      formatChildren+=`- [${closed}] [*#${child.iid} ${child.title}*](#${child.iid}) \n`
    })

    body.push(formatChildren);
  }

  if (labelCheck(assignee)) body.push(`*Assigned to ${assignee}*`);

  if (content.text || releaseNotes) body.push('---');
  if (content.text) body.push(formatContent(content.text));
  if (releaseNotes) body.push(`\n Release Notes: *${formatContent(content.text)}*`);

  return body.join("\n\n");
}

// function formatAttachments(attachments){
//   if(!attachments) return [];
//
//   let raw_attachments;
//
//   switch(instanceof attachments['attachment']){
//     case Array:
//       raw_attachments = attachments['attachment'];
//       break;
//     default:
//       raw_attachments = [attachments['attachment']];
//       break;
//   }

//   raw_attachments = raw_attachments.map(attachment => formatAttachment(attachment));

//   return raw_attachments.filter(n => { return n != undefined });
// }

// async function formatAttachment(attachment){
//   let url = buildAttachmentURL(attachment.sURL);

//   await let res = GitlabAPI.Projects.upload({
//     projectId: GLProject.id,
//     file: url
//   })

//   if(!res) return null;

//   return res.markdown;
// }

// function buildAttachmentURL(url){
//   return `${configuration.athentication.fogbugz.url}/${url}&token=${FogbugzAPI.token}`
// }

function formatUpdates(comment) {
  let updates = []

  if (comment.changes) updates.push(`*${linkifyIssues(escapeMarkdown(comment.changes.replace("\n", "")))}*`);

  return updates;
}

function formatIssueCommentBody(author, date, content) {
  let body = [];

  body.push(`**By ${author} on ${date} (imported from FogBugz)**`);
  body.push('---');
  body.push(content);

  // if (!attachments.any){
  //   body.push('---');
  //   body.push(attachments);
  // }

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
      return '#d9534f';
    case 'Feature':
    case 'User Story':
      return '#44ad8e';
    case 'Technical Task':
    case 'Technical Debt':
      return '#4b6dd0';
    case 'Research Spike':
      return '#ff00ff';
    default:
      return '#e2e2e2';
  }
}