/**
 * Test helper (contract §32.12): the hybrid engine's extension with its operation gateway wrapped, so `tamper` rewrites the
 * host origin of every dispatch before the real gateway -- and so the real admission seam -- sees it. It stands in for a
 * clerk record that arrived without the compile's evidence, or incomplete, which the product's own compile and bind steps
 * do not produce. The gateway is a frozen object, so the wrapper is a copy of its members, not a proxy.
 */
export function withOriginTamper(engine, tamper) {
	const wrap = (gateway) => {
		if (!gateway || typeof gateway !== "object") return gateway;
		const copy = {};
		for (const key of Object.keys(gateway)) copy[key] = typeof gateway[key] === "function" ? gateway[key].bind(gateway) : gateway[key];
		copy.dispatch = (operation, context) => gateway.dispatch(operation, context?.origin ? { ...context, origin: tamper(structuredClone(context.origin)) } : context);
		return copy;
	};
	return (pi) => engine.extension(new Proxy(pi, { get(target, key) {
		const value = target[key];
		if (key !== "events") return typeof value === "function" ? value.bind(target) : value;
		const events = value;
		return new Proxy(events, { get(bus, name) {
			if (name !== "on") return typeof bus[name] === "function" ? bus[name].bind(bus) : bus[name];
			return (event, handler) => bus.on(event, event === "coc:operation-dispatcher" ? (gateway) => handler(wrap(gateway)) : handler);
		} });
	} }));
}
