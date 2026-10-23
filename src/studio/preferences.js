const KEY = "openscad-studio-ui-v1";
const validators = {
	horizontal: (value) => Number.isFinite(value) && value >= 0 && value <= 100,
	vertical: (value) => Number.isFinite(value) && value >= 0 && value <= 100,
	tab: (value) => ["hide-tab", "slice-tab", "measure-tab", "animation-tab", "customizer-tab", "audit-tab"].includes(value),
	projection: (value) => ["perspective", "orthographic"].includes(value),
	axes: (value) => typeof value === "boolean",
	marks: (value) => typeof value === "boolean",
};

export function uiPreferences() {
	let values = {};
	function warn(error) {
		console.warn("UI preferences could not be saved or restored:", error);
		const message = document.getElementById("preferences-message");
		message.hidden = false; message.textContent = "UI preferences unavailable";
		message.title = error.message;
	}
	try {
		const saved = localStorage.getItem(KEY);
		if (saved) {
			const parsed = JSON.parse(saved);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Invalid UI preferences");
			for (const [key, validate] of Object.entries(validators)) if (Object.hasOwn(parsed, key)) {
				if (!validate(parsed[key])) throw new TypeError(`Invalid UI preference: ${key}`);
				values[key] = parsed[key];
			}
		}
	} catch (error) { values = {}; warn(error); }
	return {
		get(key) { return values[key]; },
		set(patch) {
			for (const [key, value] of Object.entries(patch)) {
				if (!validators[key]?.(value)) throw new TypeError(`Invalid UI preference: ${key}`);
			}
			Object.assign(values, patch);
			try { localStorage.setItem(KEY, JSON.stringify(values)); }
			catch (error) { warn(error); }
		},
	};
}
