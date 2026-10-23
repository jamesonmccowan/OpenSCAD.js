export function fontControls(host) {
	const tab = document.querySelector('#fonts-tab');
	const search = document.querySelector('#font-search');
	const refresh = document.querySelector('#font-refresh');
	const status = document.querySelector('#font-status');
	const list = document.querySelector('#font-list');
	let faces = [];
	let loaded = false;
	let waiting = false;
	let nextRequest = 0;
	let requestId;
	let timer;
	const showStatus = (text, error = false) => {
		status.textContent = text;
		status.classList.toggle('error', error);
	};
	function render() {
		list.replaceChildren();
		const query = search.value.trim().toLowerCase();
		const matches = faces.filter(face => face.name.toLowerCase().includes(query));
		for (const face of matches) {
			const row = document.createElement('div');
			row.className = 'font-row';
			row.setAttribute('role', 'listitem');
			const code = document.createElement('code');
			code.textContent = `font=${JSON.stringify(face.name)}`;
			const origin = document.createElement('span');
			origin.className = 'font-origin';
			origin.textContent = face.source === 'bundled' ? 'Bundled' : face.source === 'directory' ? 'Font directory' : 'Host installed';
			const copy = document.createElement('button');
			copy.type = 'button';
			copy.textContent = 'Copy';
			copy.setAttribute('aria-label', `Copy font ${face.name}`);
			copy.addEventListener('click', () => {
				host.postMessage({ type: 'fontCopy', name: face.name });
			});
			row.append(code, origin, copy);
			list.append(row);
		}
		showStatus(`${matches.length} of ${faces.length} faces${matches.length ? '. Copy places a SCAD font assignment on the clipboard; source is unchanged.' : '. No matching fonts.'}`);
	}
	function load() {
		if (waiting) return;
		waiting = true;
		refresh.disabled = true;
		requestId = ++nextRequest;
		showStatus('Discovering readable fonts on the extension host...');
		host.postMessage({ type: 'fontList', requestId });
		timer = setTimeout(() => {
			waiting = false;
			requestId = undefined;
			refresh.disabled = false;
			showStatus('Font discovery timed out. Use Refresh to try again.', true);
		}, 30_000);
	}
	tab.addEventListener('click', () => { if (!loaded) load(); });
	// Keyboard tab navigation activates panels without dispatching a click.
	const observer = new MutationObserver(() => {
		if (!document.querySelector('#fonts-controls').hidden && !loaded) load();
	});
	observer.observe(document.querySelector('#fonts-controls'), { attributes: true, attributeFilter: ['hidden'] });
	refresh.addEventListener('click', load);
	search.addEventListener('input', () => { if (loaded && !waiting) render(); });
	window.addEventListener('message', ({ data: message }) => {
		if (message.type === 'fontListResult' && message.requestId === requestId) {
			clearTimeout(timer);
			waiting = false;
			requestId = undefined;
			refresh.disabled = false;
			if (message.error) { showStatus(`Font discovery failed: ${message.error}. Use Refresh to retry.`, true); return; }
			faces = message.fonts;
			loaded = true;
			document.querySelector('#font-host').textContent = message.host;
			render();
		} else if (message.type === 'fontCopied') {
			showStatus(message.error ? `Could not copy font: ${message.error}` : `Copied font=${JSON.stringify(message.name)}`, Boolean(message.error));
		} else if (message.type === 'init') {
			clearTimeout(timer);
			waiting = false;
			requestId = undefined;
			refresh.disabled = false;
			loaded = false;
			faces = [];
			list.replaceChildren();
			showStatus('Open this panel to discover available fonts.');
			if (!document.querySelector('#fonts-controls').hidden) load();
		}
	});
}
