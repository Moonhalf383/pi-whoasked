import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerWhoasked } from "./extension.ts";

export default function whoasked(pi: ExtensionAPI): void {
  registerWhoasked(pi, getAgentDir());
}
