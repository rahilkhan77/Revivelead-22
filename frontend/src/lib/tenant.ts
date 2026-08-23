export function ownedId(organizationId: string, id: string) {
  return { id, organizationId };
}

export function assertMutated(count: number, message = "Record not found.") {
  if (count === 0) {
    throw new Error(message);
  }
}
