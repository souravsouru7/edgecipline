// Installs the "@/" resolve hook for `node --test`. See alias-hooks.mjs.
import { register } from "node:module";
register("./alias-hooks.mjs", import.meta.url);
