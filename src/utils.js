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
    }).replace(/\s+/g, ' ');
}

function linkifyIssues(str) {
  str = str.replace(/([Ii]ssue) ([0-9]+)/, '\1 #\2');
  return str.replace(/([Cc]ase) ([0-9]+)/, '\1 #\2');
}