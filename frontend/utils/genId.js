// Short client-side id for list items that exist only until they are saved
// (pending uploads, draft rules). Not for anything the server keys on.
export function genId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
