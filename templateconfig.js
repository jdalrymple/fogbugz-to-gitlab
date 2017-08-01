let CONFIGURATION_USER = {
  "authentication": {
    "fogbugz": {
      "url": "http://support.jonar.com/support/",
      "user": "justin@jonar.com",
      "password": "jamila"
    },
    "gitlab": {
      "token": "4fMmEbKQk9GKTQ13YuPA"
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
    "name": "R&D",
    // "name": "Side Projects",
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