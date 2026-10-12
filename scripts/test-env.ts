// The environment every test hands to the git it spawns. Git exports GIT_DIR & co to its hooks and
// reads them BEFORE cwd or `-C`: left in, a fixture's `git init` / `clone --bare` / `config` lands
// on the REAL repository (core.bare=true, user.name=t). It must travel with the tests — the pre-push
// hook that runs is the MAIN checkout's (core.hooksPath), not the branch's — and it must be passed
// explicitly: Bun.spawn without `env` inherits the process's original environment, whatever
// process.env says since.
const { GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_PREFIX, GIT_COMMON_DIR, GIT_OBJECT_DIRECTORY, ...rest } = process.env;
export const gitFreeEnv: Record<string, string | undefined> = rest;
