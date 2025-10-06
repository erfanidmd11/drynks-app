// No-op Branch shim for Expo Go (no native module there)
class BranchEvent {
  constructor(_name, _params) {}
  logEvent() {}
}

const branch = {
  subscribe: () => ({ remove() {} }),
  initSession: async () => ({}),
  getLatestReferringParams: async () => ({}),
  getFirstReferringParams: async () => ({}),
  setIdentity: async () => {},
  logout: async () => {},
};

module.exports = branch;
module.exports.BranchEvent = BranchEvent;
module.exports.default = branch;
