"use strict";
/**
 * FINAL INTERMEDIATE REPRESENTATION (IR) - ALL PHASES
 *
 * Complete type definitions for web-to-Figma data exchange
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTextNode = isTextNode;
exports.isImageNode = isImageNode;
exports.isSVGNode = isSVGNode;
exports.isFrameNode = isFrameNode;
exports.hasScreenshot = hasScreenshot;
exports.hasStates = hasStates;
exports.hasPseudoElements = hasPseudoElements;
// Type guards
function isTextNode(node) {
    return node.type === 'TEXT' && !!node.text;
}
function isImageNode(node) {
    return node.type === 'IMAGE' && !!node.image;
}
function isSVGNode(node) {
    return node.type === 'SVG' && !!node.svg;
}
function isFrameNode(node) {
    return node.type === 'FRAME' && node.children.length > 0;
}
function hasScreenshot(node) {
    return !!node.screenshot;
}
function hasStates(node) {
    return !!node.states && Object.keys(node.states).length > 0;
}
function hasPseudoElements(node) {
    return !!node.pseudoElements && node.pseudoElements.length > 0;
}
//# sourceMappingURL=ir.js.map