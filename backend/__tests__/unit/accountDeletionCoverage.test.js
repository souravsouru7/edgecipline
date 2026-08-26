'use strict';

/**
 * Account deletion coverage guard.
 *
 * Google Play's User Data policy and Apple Guideline 5.1.1(v) require that
 * deleting an account actually removes the user's data. The failure mode this
 * test exists to catch is silent: someone adds a new model with a `user` ref,
 * never adds it to accountDeletionService, and that collection quietly
 * survives every deletion from then on. Nothing in the app would look broken.
 *
 * So rather than test the delete calls, this scans models/ for anything that
 * references the Users collection and asserts the service accounts for it —
 * either by purging it, or by naming it in the documented retain list.
 */

const fs = require('fs');
const path = require('path');

const { USER_OWNED_COLLECTIONS } = require('../../services/accountDeletionService');

const MODELS_DIR = path.join(__dirname, '..', '..', 'models');
const SERVICE_PATH = path.join(__dirname, '..', '..', 'services', 'accountDeletionService.js');

// Collections deliberately NOT purged. Keep this list short and justified —
// each entry is a decision to retain data after a deletion request.
const INTENTIONALLY_RETAINED = new Set([
  // Financial records: statutory retention. Carry no personal data beyond the
  // user ObjectId, which is anonymous once the Users document is gone.
  'Payment',
  'WebhookEvent',
  // The account record itself, removed explicitly at the end of deleteAccount.
  'Users',
]);

/** Model files that hold a ref to the Users collection, and on which field. */
function findUserOwnedModels() {
  const found = [];

  for (const file of fs.readdirSync(MODELS_DIR).filter((f) => f.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(MODELS_DIR, file), 'utf8');
    const fields = new Set();

    const fieldPattern = /(\w+)\s*:\s*\{[^{}]*?ref\s*:\s*["'](\w+)["']/gs;
    let match;
    while ((match = fieldPattern.exec(source)) !== null) {
      const [, fieldName, refName] = match;
      // `deletedBy` points at the admin who removed a row, not the owner.
      if (refName.toLowerCase().startsWith('user') && fieldName !== 'deletedBy') {
        fields.add(fieldName);
      }
    }

    if (fields.size > 0) {
      found.push({ modelName: path.basename(file, '.js'), fields: [...fields] });
    }
  }

  return found;
}

describe('account deletion covers every user-owned collection', () => {
  const service = fs.readFileSync(SERVICE_PATH, 'utf8');
  const userOwned = findUserOwnedModels();

  it('finds the models to check', () => {
    // Sanity check on the scanner itself — if the regex silently stops
    // matching, every assertion below would vacuously pass.
    expect(userOwned.length).toBeGreaterThan(15);
  });

  it.each(userOwned.map((m) => [m.modelName, m.fields]))(
    '%s is purged or explicitly retained',
    (modelName, fields) => {
      if (INTENTIONALLY_RETAINED.has(modelName)) return;

      expect(service).toContain(`models/${modelName}`);

      // ...and purged on the right field, so a model keyed by `userId` is not
      
      // wired up as `user` (which would delete nothing and report success).
      const purgedOnCorrectField = fields.some((field) => {
        // The trailing `.Prop` is optional: model files that export a bag of
        // named values rather than the model itself have to be unwrapped.
        const direct = new RegExp(
          `\\["${field}",\\s*require\\("\\.\\./models/${modelName}"\\)(?:\\.\\w+)?\\]`
        );
        // Models imported at the top of the service are referenced by variable.
        const viaVariable = new RegExp(`\\["${field}",\\s*${modelName}\\]`);
        return direct.test(service) || viaVariable.test(service);
      });

      expect(purgedOnCorrectField).toBe(true);
    }
  );

  // The checks above only prove the service mentions the right model file on the
  // right field. They cannot tell whether `require(...)` actually handed back a
  // model — and OCRJob exports `{ OCR_JOB_STATUSES, OCRJob }`, so it handed back
  // a plain object whose `.deleteMany` was undefined. Every text-level assertion
  // passed while real deletions died on "Model.deleteMany is not a function",
  // after the account had already been locked out. Check the values, not the source.
  it.each(USER_OWNED_COLLECTIONS.map((entry, i) => [i, entry]))(
    'entry %i is a real mongoose model',
    (_index, [field, Model]) => {
      expect(typeof field).toBe('string');
      expect(typeof Model?.deleteMany).toBe('function');
      expect(typeof Model?.modelName).toBe('string');
    }
  );

  it('purges on a field the model actually defines', () => {
    // A model keyed by `userId` wired up as `user` deletes nothing and still
    // reports success — the silent-survival failure mode, one level deeper.
    for (const [field, Model] of USER_OWNED_COLLECTIONS) {
      expect(Model.schema.path(field)).toBeDefined();
    }
  });

  it('retains only what is documented', () => {
    // Guards against quietly adding a model to the retain list: every name in
    // it must still exist as a model file.
    for (const name of INTENTIONALLY_RETAINED) {
      expect(fs.existsSync(path.join(MODELS_DIR, `${name}.js`))).toBe(true);
    }
  });
});
