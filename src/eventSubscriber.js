const typeAbbreviations = {
  Table: "Tab",
  Codeunit: "Cod",
  Page: "Pag",
  Report: "Rep",
};

function isEventSubscriberTemplate(content) {
  const alCodePattern =
    //  /\[EventSubscriber\(.*?\)\][\s\S]*?local procedure[\s\S]*?begin[\s\S]*?end;/;
    /\[EventSubscriber\(.*?\)\][\s\S]*?local procedure[\s\S]*?begin\s*end;/;
  return alCodePattern.test(content);
}

function modifyEventSubscriberTemplate(content) {
  // Step 1: Find the event subscriber attributes
  const eventSubscriberMatch = content.match(/\[EventSubscriber\([^)]+\)\]/);
  if (!eventSubscriberMatch) return content;

  const eventSubscriberText = eventSubscriberMatch[0];

  // Step 2: Split the object type, object name, and event name
  const objectTypeMatch = eventSubscriberText.match(/ObjectType::(\w+)/);
  const objectNameRegex =
    /(?:Database|Codeunit|Page|Report|Table)::["']([^"']+)["']/;
  const objectNameMatch = eventSubscriberText.match(objectNameRegex);
  const eventNameMatch = eventSubscriberText.match(/,\s*(\w+),/);

  if (!objectTypeMatch || !objectNameMatch || !eventNameMatch) {
    return content;
  }

  // Step 3: Get the necessary components
  const objectType = objectTypeMatch[1];
  const objectName = objectNameMatch[1];
  const eventName = eventNameMatch[1];

  // Step 4: Map object type to its abbreviation
  const typeAbbr = typeAbbreviations[objectType] || objectType.substring(0, 3);

  // Step 5: Clean object name (remove special characters)
  const cleanObjectName = objectName.replace(/[^a-zA-Z0-9]/g, "");

  // Step 6: Create the new procedure name
  const newProcedureName = `${typeAbbr}${cleanObjectName}_${eventName}`;

  // Step 7: Find and replace the procedure name in the content
  // Handle both quoted and unquoted procedure names
  const updatedContent = content.replace(
    /local procedure (?:["'][^"']+["']|[^(]+)\(/,
    `local procedure ${newProcedureName}(`
  );

  return updatedContent;
}

module.exports = {
  isEventSubscriberTemplate,
  modifyEventSubscriberTemplate,
};
