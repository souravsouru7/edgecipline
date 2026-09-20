"use strict";

// Accounts created before `accountStatus` existed have no value at all; treat
// those as active. Anything other than "active" (e.g. "deleting", "disabled")
// is not.
function isAccountActive(user) {
  return !user?.accountStatus || user.accountStatus === "active";
}

module.exports = { isAccountActive };
