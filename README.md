# ARMAG

**ARMAG** (from *arm* + *magazine*) is a free, non-profit reference for firearms — no ads, no accounts, no trackers, and nothing to subscribe to.

The name works twice over: a magazine is what a firearm is fed from, and a magazine is what this is. One page per firearm, one per cartridge, one per manufacturer, joined by a lineage graph and laid out like a magazine rather than a database dump.

Every figure on it is either sourced or computed, and it always says which. A specification carries the document it came from, cited down to the revision it was read at, and a number nobody has published yet is shown as a gap rather than quietly filled in with something plausible. That rule is enforced by the build rather than by good intentions: the schema refuses a "verified" figure with no link to click, a hedge word in a source note stops the build, and prose that reads like the entry next to it fails a similarity gate.

It also does the physics. Trajectory, retained energy, momentum, recoil and sight geometry are integrated from each cartridge's own published data with a real RK4 solver over the public-domain G1 and G7 drag tables — validated against published ballistic tables and against an independent open-source implementation. Every derived number opens a panel showing the formula, its inputs, and where each input came from. A muzzle velocity is corrected for a barrel length only when a source published that pairing; interpolation between two sourced points is allowed and labelled, extrapolation never is, and there is no generic feet-per-second-per-inch constant anywhere in the codebase — a test proves it.

There is deliberately no damage, lethality or "stopping power" figure, in v1 or ever. Energy is physics; stopping power is discredited pseudoscience. There is no legal or regulatory layer either: the site states what a firearm *is*, never what a reader may do with it.

Browse it by type, action, operating system, feed, role, country or era — every one of those a view computed over tagged entries, so nothing breaks when an entry is reclassified. Compare four arms side by side with real percentile bars carrying real units, work out recoil or trajectory for a load that interests you, or keep a private record of what you own and what you have put through it.

Nothing you do here leaves your browser. A comparison, an armory, a shared layout — each lives in your own storage or travels in a link you choose to share, because there is no server to send it to.

---

© 2026 Kiarash Farajzadehahary.

⚖ Licensed under the [KFA Source-Available License 1.0](LICENSE).

Made with ❤️ and `½ · m · v²`
