import { bindCurrentAccountPreview } from "../server/cms/currentAccountPreview.ts";

export default { fetch: bindCurrentAccountPreview(process.env) };
