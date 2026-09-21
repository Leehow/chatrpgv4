import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const faux = fauxProvider({
	provider: "s0-rpc-fixture",
	models: [{ id: "keeper", reasoning: false }],
});
faux.setResponses([fauxAssistantMessage("Fixture persistence acknowledgement.")]);

export default function (pi) {
	pi.registerProvider(faux.provider);
	pi.registerTool({
		name: "recall",
		label: "Recall",
		description: "Lifecycle fixture recall.",
		parameters: Type.Object({ what: Type.String() }),
		async execute(_id, args) {
			return { content: [{ type: "text", text: args.what }], details: { cards: [] } };
		},
	});
	pi.registerTool({
		name: "narrate",
		label: "Narrate",
		description: "Lifecycle fixture writer.",
		parameters: Type.Object({ text: Type.String() }),
		async execute(_id, args) {
			return { content: [{ type: "text", text: args.text }], details: { rendered_text: args.text }, terminate: true };
		},
	});
	pi.registerTool({
		name: "ask",
		label: "Ask",
		description: "Lifecycle fixture writer.",
		parameters: Type.Object({ kind: Type.String() }),
		async execute(_id, args) {
			return { content: [], details: { rendered_text: args.kind }, terminate: true };
		},
	});
}
