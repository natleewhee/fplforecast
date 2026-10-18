// Lets the unit tests import code that uses the app's "@/" alias (the API
// routes): maps "@/x" to src/x(.ts), then falls through to Node's resolver.
import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);
