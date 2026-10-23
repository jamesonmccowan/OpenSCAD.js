export const FONT_FACES = Object.freeze([
	["Liberation Sans", "Regular", "LiberationSans-Regular.ttf"],
	["Liberation Sans", "Bold", "LiberationSans-Bold.ttf"],
	["Liberation Sans", "Italic", "LiberationSans-Italic.ttf"],
	["Liberation Sans", "Bold Italic", "LiberationSans-BoldItalic.ttf"],
	["Liberation Serif", "Regular", "LiberationSerif-Regular.ttf"],
	["Liberation Serif", "Bold", "LiberationSerif-Bold.ttf"],
	["Liberation Serif", "Italic", "LiberationSerif-Italic.ttf"],
	["Liberation Serif", "Bold Italic", "LiberationSerif-BoldItalic.ttf"],
	["Liberation Mono", "Regular", "LiberationMono-Regular.ttf"],
	["Liberation Mono", "Bold", "LiberationMono-Bold.ttf"],
	["Liberation Mono", "Italic", "LiberationMono-Italic.ttf"],
	["Liberation Mono", "Bold Italic", "LiberationMono-BoldItalic.ttf"],
].map(([family, style, filename]) => Object.freeze({ family, style, filename, key: `${family.toLowerCase()}|${style.toLowerCase()}` })));
