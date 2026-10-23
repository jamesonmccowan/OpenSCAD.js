export function paneLayout(preferences) {
	const main = document.querySelector("main"), divider = document.getElementById("pane-divider");
	const viewer = document.getElementById("viewport-pane");
	const stacked = matchMedia("(max-width: 760px)");
	const shares = { horizontal: preferences.get("horizontal") ?? 42, vertical: preferences.get("vertical") ?? 46 };
	let drag;
	const mode = () => stacked.matches ? "vertical" : "horizontal";
	function limits() {
		const total = Math.max(1, (stacked.matches ? main.clientHeight : main.clientWidth) - divider.getBoundingClientRect()[stacked.matches ? "height" : "width"]);
		const overhead = [...viewer.children].filter((child) => !child.classList.contains("viewport-stage")).reduce((sum, child) => sum + child.getBoundingClientRect().height, 0);
		const editorMin = Math.min(stacked.matches ? 180 : 280, total * 0.35);
		const viewerMin = Math.min(stacked.matches ? overhead + 120 : 340, total - editorMin);
		return { total, min: editorMin / total * 100, max: (total - viewerMin) / total * 100 };
	}
	function apply(value) {
		if (value !== undefined) shares[mode()] = Math.min(100, Math.max(0, value));
		const { min, max } = limits();
		const share = Math.min(max, Math.max(min, shares[mode()]));
		main.style.setProperty("--editor-share", `${share}fr`);
		main.style.setProperty("--viewer-share", `${100 - share}fr`);
		divider.setAttribute("aria-orientation", stacked.matches ? "horizontal" : "vertical");
		divider.setAttribute("aria-valuemin", String(Math.floor(min)));
		divider.setAttribute("aria-valuemax", String(Math.ceil(max)));
		divider.setAttribute("aria-valuenow", String(Math.round(share)));
		divider.setAttribute("aria-valuetext", `${Math.round(share)}% code, ${Math.round(100 - share)}% model`);
	}
	function finishDrag() {
		if (!drag) return;
		const id = drag.id; drag = undefined; main.classList.remove("resizing");
		if (divider.hasPointerCapture(id)) divider.releasePointerCapture(id);
		preferences.set(shares);
	}
	divider.addEventListener("pointerdown", (event) => {
		if (event.button !== 0 || drag) return;
		event.preventDefault(); divider.focus();
		drag = { id: event.pointerId, coordinate: stacked.matches ? event.clientY : event.clientX, share: parseFloat(main.style.getPropertyValue("--editor-share")) };
		divider.setPointerCapture(event.pointerId); main.classList.add("resizing");
	});
	divider.addEventListener("pointermove", (event) => {
		if (drag?.id !== event.pointerId) return;
		if (event.buttons === 0) { finishDrag(); return; }
		const coordinate = stacked.matches ? event.clientY : event.clientX;
		apply(drag.share + (coordinate - drag.coordinate) / limits().total * 100);
	});
	for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) divider.addEventListener(event, finishDrag);
	window.addEventListener("blur", finishDrag);
	divider.addEventListener("keydown", (event) => {
		const { min, max } = limits(), step = event.shiftKey ? 10 : 2;
		const share = parseFloat(main.style.getPropertyValue("--editor-share"));
		let next;
		if (event.key === "Home") next = min;
		else if (event.key === "End") next = max;
		else if (event.key === (stacked.matches ? "ArrowUp" : "ArrowLeft")) next = share - step;
		else if (event.key === (stacked.matches ? "ArrowDown" : "ArrowRight")) next = share + step;
		else return;
		event.preventDefault(); apply(next);
		preferences.set(shares);
	});
	divider.addEventListener("dblclick", () => { apply(stacked.matches ? 46 : 42); preferences.set(shares); });
	const changeMode = () => { finishDrag(); apply(); };
	stacked.addEventListener("change", changeMode);
	const observer = new ResizeObserver(() => apply());
	observer.observe(main);
	for (const child of viewer.children) if (!child.classList.contains("viewport-stage")) observer.observe(child);
	apply();
	return { dispose() { finishDrag(); observer.disconnect(); stacked.removeEventListener("change", changeMode); window.removeEventListener("blur", finishDrag); } };
}
