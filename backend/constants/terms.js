const CURRENT_TERMS_VERSION = "v1.0";

// Single definition of "has this user accepted the terms we currently
// require?". The version check matters: bumping CURRENT_TERMS_VERSION must
// re-prompt everyone, and it only does that if every caller checks the same
// three fields.
function hasAcceptedCurrentTerms(user) {
  return (
    user?.termsAcceptance?.acceptedTerms === true &&
    user?.termsAcceptance?.acceptedPrivacy === true &&
    user?.termsAcceptance?.termsVersion === CURRENT_TERMS_VERSION
  );
}

function needsTermsAcceptance(user) {
  return !hasAcceptedCurrentTerms(user);
}

module.exports = { CURRENT_TERMS_VERSION, hasAcceptedCurrentTerms, needsTermsAcceptance };
