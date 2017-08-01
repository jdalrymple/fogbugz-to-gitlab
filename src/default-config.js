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