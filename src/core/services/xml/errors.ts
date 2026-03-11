export class XmlExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlExportError";
  }
}

export class XmlExportValidationError extends XmlExportError {
  constructor(message: string) {
    super(message);
    this.name = "XmlExportValidationError";
  }
}

export class XmlExportNotFoundError extends XmlExportError {
  constructor(entityName: string, id: string) {
    super(`${entityName} not found: ${id}`);
    this.name = "XmlExportNotFoundError";
  }
}

export function assertValidId(id: string, label: string): void {
  if (!id || id.trim().length === 0) {
    throw new XmlExportValidationError(`${label} is required for XML export.`);
  }
}
