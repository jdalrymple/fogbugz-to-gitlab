let temp_title = "testproject" + Math.floor(Math.random() * 200)

let CONFIGURATION_USER = {
  "authentication": {
    "fogbugz": {
      "url": "http://support.jonar.com/support/",
      "user": "dylan@jonar.com",
      "password": "jonar$1986"
    },
    "gitlab": {
      "token": "4p6hzwnFe2dkCoozfwfL"
    }
  },
  "gitlab_project":{
    "name": temp_title,
    "description": "boring description",
    "issued_enabled": true
  },
  "fogbugz_project":{
    "name": "R&D",
    // "name": "Side Projects",
    "exclude":{
      "categories": ['Task'] // Add default empty string for this
    },
    "custom_fields": ['storyxpoints', 'nextxsprint', 'nextxpoker',]
  }
}

const CONFIGURATION_DEFAULT = {
  authentication: CONFIGURATION_USER.authentication,
  gitlab_project:{
      name: CONFIGURATION_USER.gitlab_project.name || 'New Gitlab Project',
      description: CONFIGURATION_USER.gitlab_project.description || 'My Gitlab Project',
      issues_enabled: CONFIGURATION_USER.gitlab_project.issues_enabled || true,
      merge_requests_enabled: CONFIGURATION_USER.gitlab_project.merge_requests_enabled || true,
      wiki_enabled: CONFIGURATION_USER.gitlab_project.wiki_enabled || false,
  },
  fogbugz_project:{
    name:CONFIGURATION_USER.fogbugz_project.name,
    exclude :{
      categories: CONFIGURATION_USER.fogbugz_project.exclude.categories  || []
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

try{
  initAPIandCache()
  .then(importProject)
  .then(cleanMilestones)
}catch(e){
  console.log(e);
}


/*--------------------------------- Helper ----------------------------------*/

async function importProject(){

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

  //Paginate
  let moreToProcess = true;
  let processDate = new Date(Date.now()).toLocaleDateString("en-US");
  let caseNumber = "0";
  let queryString = baseQueryString + `case:"${caseNumber}.."`;

// Test cases
  // queryString = `case:"144813"`
  // queryString = `case:"108126"`
  // queryString = `case:"127305"`
  queryString = `case:"150371"`

  while (moreToProcess) {
    let cases = await FogbugzAPI.search(queryString, 100, false);

    for (data of cases){
      console.log(data)
      await importCase(data)
    }

    caseNumber = cases[cases.length-1].id + 1
    queryString = baseQueryString + `case:"${caseNumber}.."`;
    // moreToProcess = (cases.length < 100) ? false : true;
    moreToProcess =  false;
  }
}

async function initAPIandCache(){
  fogbugsConfig = Object.assign({} ,CONFIGURATION_DEFAULT.authentication.fogbugz);
  fogbugsConfig.customFields = CONFIGURATION_DEFAULT.fogbugz_project.custom_fields;

  try{
    FogbugzAPI = await FogbugzJS(fogbugsConfig);
  } catch(e){
    console.log(e)
  }

  GitlabAPI = await Gitlab(CONFIGURATION_DEFAULT.authentication.gitlab);
  FBUsers = await getAllFogbugzUsers();
  AdminUser = await GitlabAPI.users.current();
}

async function getAllFogbugzUsers(){
  let users = await FogbugzAPI.users();

  return users.filter(user => { return user.deleted === false });
}


async function importCase(data) {
  let labels = []
  let labelList = buildLabels(data)
  let author = AdminUser.username
  let date = data.opened;
  let comments = data.events;
  let content = getOpenedComment(comments);
  let body = formatIssueBody(data, content);
  let milestoneId =  await getMilestone(data.milestone);

  for (label of labelList){
    labels.push(await getLabel(label));
  }

  let issue = GLIssues.find(Issue => Issue.title.trim() === data.title.trim());

  if(!issue){
    issue = await GitlabAPI.projects.issues.create( GLProject.id, {
        title: data.title,
        description: body,
        author_id: author,
        state: data.isOpen == 'true' ? 'opened':'closed',
        milestone_id: milestoneId.id,
        created_at: date.toDateString(),
        updated_at: data.lastUpdated,
        labels: labels.map(label => label.name).join(','),
        weight: data.priority.id
    });

    // Populate Cache
    GLIssues.push(issue);

    for (comment of comments){
        if (!comment.text) continue
        await importIssueComment(issue.iid, comment)
    }
  }
}

async function populateCache(){
  let temp = await GitlabAPI.labels.all(GLProject.id);
  GLLabels = temp;
  temp = await GitlabAPI.projects.milestones.all(GLProject.id);
  GLMilestones = temp;
  temp = await GitlabAPI.projects.issues.all(GLProject.id);
  GLIssues = temp
}

function buildLabels(data){
  let labelList = []

  labelList.push(data.category.name)
  if (data.tags.length) {
    for (tag of data.tags){
      labelList.push(tag)
    }
  }

  for (let i = 0; i < labelList.length; i++) {
    labelList[i] = labelList[i].charAt(0).toUpperCase() + labelList[i].slice(1).toLowerCase();
  }

  if (data.nextxsprint) labelList.push("Next Sprint")
  if (data.nextxpoker) labelList.push("Next Poker")
  if (data.storyxpoints) labelList.push(`Points: ${data.storyxpoints}`)

  return labelList
}

async function importIssueComment(issueId, comment) {
  let author = comment.person.name
  let content = formatContent(comment.html)
  let date = comment.date.toDateString()
  // let attachments = formatAttachments(comment.attachments)

  // if (!content && !attachments.length) return;
  if(!content) return;

  let body = formatIssueCommentBody(author, date, content)

  await GitlabAPI.projects.issues.notes.create( GLProject.id, issueId, {
      created_at: date,
      body: body
  });
}

async function getLabel(fogbugsLabelName){
  let label = GLLabels.find(label => label.name === fogbugsLabelName);

  if(!label){
      let glLabel = await GitlabAPI.labels.create( GLProject.id, {
          name: fogbugsLabelName,
          color: labelColours(fogbugsLabelName)
      });

      GLLabels.push(glLabel);

      label = glLabel;
  }

  return label;
}

function labelCheck(info){
  return (!((info === 'Up For Grabs') || (info === 'CLOSED')))
}


async function getMilestone(fogbugzMilestone){
  let milestone = GLMilestones.find(milestone => milestone.title === fogbugzMilestone.name);

  if(!milestone){
    let GLMilestone = await GitlabAPI.projects.milestones.add(GLProject.id, fogbugzMilestone.name, {
        due_date: fogbugzMilestone.end.toDateString()
    });

    GLMilestones.push(GLMilestone);

    milestone = GLMilestone;
  }

  return milestone;
}

async function cleanMilestones(){
  let activeMilestones = ["Sprint 100",
                          "Short-Term Product Backlog",
                          "Product Backlog",
                          "Special Projects Backlog"]

  for (milestone of GLMilestones) {
    if(activeMilestones.indexOf(milestone) == -1){
      await GitlabAPI.projects.milestones.update(GLProject.id, milestone.id, {state_event: "close"})
    }
  }
}

function getOpenedComment(comments) {
  return comments.find((comment) =>
    comment.verb === "Opened"
  )
}

function formatContent(content){
  if(!content) return '';

  return linkifyIssues(escapeMarkdown(content))
}

function formatIssueBody(data, content){
  let caseNumber = data.id
  let author = content.description
  let date = data.opened.toDateString()
  let assignee = data.assignee.name
  let parentId = data.parentId
  let children = data.children
  let releaseNotes = data.releaseNotes

  let body = [];
  let header = `${author} | Case: ${caseNumber}`
  body.push(`**${header}**`);
  if (parentId) { body.push(`*Parent: ${parentId}*`) }
  if (children[0]) { body.push(`*Children: ${children}*`) }
  if (labelCheck(assignee)) { body.push(`*Assigned to ${assignee}*`); }

  if (content.text != '' || releaseNotes != '') body.push('---');
  if (content.text != ''){ body.push(formatContent(content.text)); }
  if (releaseNotes != ''){ body.push(`<br>**Release Notes** <br>*${formatContent(content.text)}*`); }

  return body.join("\n\n");
}

function formatAttachments(attachments){
  if(!attachments) return [];

  let raw_attachments;

  switch(instanceof attachments['attachment']){
    case Array:
      raw_attachments = attachments['attachment'];
      break;
    default:
      raw_attachments = [attachments['attachment']];
      break;
  }

  raw_attachments = raw_attachments.map(attachment => formatAttachment(attachment));

  return raw_attachments.filter(n => { return n != undefined });
}
//
// async function formatAttachment(attachment){
//   let url = buildAttachmentURL(attachment.sURL);
//
//   await let res = GitlabAPI.Projects.upload({
//     projectId: GLProject.id,
//     file: url
//   })
//
//   if(!res) return null;
//
//   return res.markdown;
// }
//
// function buildAttachmentURL(url){
//   return `${configuration.athentication.fogbugz.url}/${url}&token=${FogbugzAPI.token}`
// }

function formatUpdates(comment){
  let updates = []

  if (comment.changes) updates.push(`*${linkifyIssues(escapeMarkdown(comment.changes.replace("\n", "")))}*`);
  // if (comment.description) updates.push(`*${comment.description}*`);

  return updates;
}

// function formatIssueCommentBody(author, date, content, attachment){
function formatIssueCommentBody(author, date, content){
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

function linkifyIssues(str){
  str = str.replace(/([Ii]ssue) ([0-9]+)/, '\1 #\2');
  return str.replace(/([Cc]ase) ([0-9]+)/, '\1 #\2');
}

function escapeMarkdown(str){
  str = str.replace(/^#/, "\\#")
  str = str.replace(/^-/, "\\-")
  str = str.replace("`", "\\~")
  str = str.replace("\r", "")

  return str.replace("\n", "  \n")
}

function labelColours(name){
  switch(name){
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
