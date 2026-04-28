"use strict";
// Metamorpho - Skeleton UI Generator
// Transforms selected elements into flat skeleton UI with shapes only
figma.showUI(__html__, {
    width: 280,
    height: 480,
    themeColors: true
});
const OFFSET_X = 50;
let currentOptions = {
    heightAdjust: 0,
    pillColor: null,
    createOnTop: false,
    multiplePills: false // Default: only 1 pill per line
};
let copiedNodes = [];
figma.ui.onmessage = async (msg) => {
    if (msg.type === 'transform-to-skeleton') {
        const selection = figma.currentPage.selection;
        if (selection.length === 0) {
            figma.notify('⚠️ Please select elements to transform');
            return;
        }
        // Store options from UI
        currentOptions = {
            heightAdjust: msg.heightAdjust || 0,
            pillColor: msg.pillColor || null,
            createOnTop: msg.createOnTop || false,
            multiplePills: msg.multiplePills || false
        };
        console.log('Transform options:', currentOptions);
        const newNodes = [];
        for (const node of selection) {
            const skeletonNode = await createFlatSkeleton(node);
            if (skeletonNode) {
                newNodes.push(skeletonNode);
            }
        }
        figma.currentPage.selection = newNodes;
        figma.notify(`✨ Created ${newNodes.length} flat skeleton element(s)`);
    }
    else if (msg.type === 'copy-selection') {
        await copySelection();
    }
    else if (msg.type === 'paste-selection') {
        await pasteSelection();
    }
    else if (msg.type === 'flatten-merge') {
        await flattenAndMerge();
    }
    else if (msg.type === 'frame-to-shape') {
        await convertFrameToShape();
    }
    else if (msg.type === 'group-by-color') {
        await groupByColor();
    }
};
async function createFlatSkeleton(node) {
    // Get bounding box for positioning
    const bounds = node.absoluteBoundingBox;
    if (!bounds)
        return null;
    // Create container frame (without auto layout)
    const container = figma.createFrame();
    container.name = `${node.name} (Skeleton)`;
    container.resize(bounds.width, bounds.height);
    // Position based on createOnTop option (using absolute coordinates)
    if (currentOptions.createOnTop) {
        // Create on top - same position as original
        container.x = bounds.x;
        container.y = bounds.y;
        console.log('Creating skeleton ON TOP at:', container.x, container.y);
    }
    else {
        // Create to the side - offset to the right
        container.x = bounds.x + bounds.width + OFFSET_X;
        container.y = bounds.y;
        console.log('Creating skeleton TO THE SIDE at:', container.x, container.y);
    }
    // Remove auto layout from container
    container.layoutMode = 'NONE';
    // Transparent background
    container.fills = [];
    // Collect shapes and cloned nodes
    const skeletonShapes = [];
    const clonedNodes = [];
    await collectElements(node, bounds.x, bounds.y, skeletonShapes, clonedNodes);
    console.log(`Collected ${skeletonShapes.length} skeleton shapes and ${clonedNodes.length} cloned nodes from`, node.name);
    // Create rectangles for skeleton shapes (texts, frames)
    const createdRects = new Map();
    for (const shape of skeletonShapes) {
        const rect = figma.createRectangle();
        rect.name = shape.name || 'Skeleton Shape';
        // Position relative to container
        rect.x = shape.x;
        rect.y = shape.y;
        rect.resize(Math.max(shape.width, 2), Math.max(shape.height, 2));
        // Apply fill
        rect.fills = [shape.fill];
        rect.cornerRadius = shape.cornerRadius;
        container.appendChild(rect);
        // Track rectangles by groupId for flattening
        if (shape.groupId) {
            if (!createdRects.has(shape.groupId)) {
                createdRects.set(shape.groupId, []);
            }
            createdRects.get(shape.groupId).push(rect);
        }
    }
    // Flatten multiline text pills (groups with multiple rectangles)
    for (const [groupId, rects] of createdRects.entries()) {
        if (rects.length > 1) {
            console.log(`Flattening ${rects.length} pills from group ${groupId}`);
            try {
                // Flatten the group of pills into a single shape
                const flattened = figma.flatten(rects);
                if (flattened) {
                    flattened.name = 'Text Skeleton';
                    console.log(`✓ Successfully flattened ${rects.length} pills into single shape`);
                }
            }
            catch (error) {
                console.error(`Failed to flatten pills group ${groupId}:`, error);
            }
        }
    }
    // Add cloned nodes (existing shapes) as-is
    for (const item of clonedNodes) {
        item.node.x = item.x;
        item.node.y = item.y;
        container.appendChild(item.node);
        // Try to flatten after adding to container
        if (item.node.type === 'VECTOR' || item.node.type === 'BOOLEAN_OPERATION') {
            try {
                const flattened = figma.flatten([item.node]);
                if (flattened) {
                    console.log('Successfully flattened vector in container');
                }
            }
            catch (e) {
                console.log('Could not flatten after adding to container:', e);
            }
        }
    }
    // Add to the page (top of layers hierarchy - appears at the top in layers panel)
    figma.currentPage.appendChild(container);
    return container;
}
async function collectElements(node, containerX, containerY, skeletonShapes, clonedNodes) {
    console.log('Collecting from:', node.type, node.name);
    // Skip hidden nodes
    if ('visible' in node && !node.visible) {
        console.log('Skipping hidden node:', node.name);
        return;
    }
    // Get absolute position
    const bounds = node.absoluteBoundingBox;
    if (!bounds) {
        console.log('No bounds for:', node.name);
        return;
    }
    const relativeX = bounds.x - containerX;
    const relativeY = bounds.y - containerY;
    console.log(`Position: (${relativeX}, ${relativeY}), Size: ${bounds.width}x${bounds.height}`);
    // Handle text nodes - convert to pills
    if (node.type === 'TEXT') {
        console.log('Processing TEXT node:', node.name);
        await handleTextNode(node, relativeX, relativeY, skeletonShapes);
        return; // Don't process children of text
    }
    // Handle instances - just process children like a regular frame
    if (node.type === 'INSTANCE') {
        console.log('Processing INSTANCE, treating as frame...');
        // Process instance like a container (access its children directly)
        if ('children' in node) {
            for (const child of node.children) {
                await collectElements(child, containerX, containerY, skeletonShapes, clonedNodes);
            }
        }
        return;
    }
    // Handle shapes (rectangles, ellipses, vectors, etc.) - CLONE them, don't convert
    if (isShape(node)) {
        console.log('Processing SHAPE:', node.type, '- CLONING original shape');
        // Clone the shape to preserve its original form
        if ('clone' in node) {
            const clonedShape = node.clone();
            console.log('Cloned shape:', clonedShape.type, clonedShape.name);
            // Remove clipping mask properties
            if ('isMask' in clonedShape) {
                clonedShape.isMask = false;
                console.log('Removed mask property from shape');
            }
            // Remove constraints that might cause issues
            if ('constraints' in clonedShape) {
                clonedShape.constraints = {
                    horizontal: 'MIN',
                    vertical: 'MIN'
                };
            }
            // Handle image fills in shapes
            if ('fills' in clonedShape && Array.isArray(clonedShape.fills) && clonedShape.fills.length > 0) {
                const firstFill = clonedShape.fills[0];
                if (firstFill.type === 'IMAGE') {
                    console.log('Shape has IMAGE fill, replacing with gray');
                    clonedShape.fills = [{
                            type: 'SOLID',
                            color: { r: 0.85, g: 0.85, b: 0.85 },
                            opacity: firstFill.opacity || 1
                        }];
                }
            }
            clonedNodes.push({
                node: clonedShape,
                x: relativeX,
                y: relativeY
            });
        }
        return; // Shapes don't have children
    }
    // Handle frames/groups - convert fills to shapes, then process children
    if (isContainer(node)) {
        console.log('Processing CONTAINER:', node.type, 'with', ('children' in node ? node.children.length : 0), 'children');
        // If frame has fills, create a shape for it
        if ('fills' in node && Array.isArray(node.fills) && node.fills.length > 0) {
            const firstFill = node.fills[0];
            // Detect corner radius
            const cornerRadius = ('cornerRadius' in node && typeof node.cornerRadius === 'number')
                ? node.cornerRadius
                : 0;
            if (firstFill.type === 'SOLID') {
                console.log('Container has SOLID fill, creating background shape');
                skeletonShapes.push({
                    x: relativeX,
                    y: relativeY,
                    width: bounds.width,
                    height: bounds.height,
                    fill: {
                        type: 'SOLID',
                        color: firstFill.color,
                        opacity: firstFill.opacity || 1 // Keep original opacity
                    },
                    cornerRadius
                });
            }
            else if (firstFill.type === 'IMAGE') {
                console.log('Container has IMAGE fill, replacing with gray');
                skeletonShapes.push({
                    x: relativeX,
                    y: relativeY,
                    width: bounds.width,
                    height: bounds.height,
                    fill: {
                        type: 'SOLID',
                        color: { r: 0.85, g: 0.85, b: 0.85 }, // Gray for images
                        opacity: firstFill.opacity || 1
                    },
                    cornerRadius
                });
            }
        }
        // Process children (but don't inherit auto layout)
        if ('children' in node) {
            console.log('Processing children...');
            for (const child of node.children) {
                await collectElements(child, containerX, containerY, skeletonShapes, clonedNodes);
            }
        }
    }
}
async function handleTextNode(textNode, x, y, shapes) {
    try {
        // Load font to access properties
        const fontName = textNode.fontName || { family: 'Inter', style: 'Regular' };
        await figma.loadFontAsync(fontName);
        // Extract text color
        let fillColor = { r: 0.85, g: 0.85, b: 0.85 };
        let originalOpacity = 1;
        if (textNode.fills !== figma.mixed && Array.isArray(textNode.fills) && textNode.fills.length > 0) {
            const firstFill = textNode.fills[0];
            if (firstFill.type === 'SOLID') {
                fillColor = firstFill.color;
                originalOpacity = firstFill.opacity || 1;
            }
        }
        // Override with custom pill color if provided
        if (currentOptions.pillColor) {
            const originalColor = fillColor;
            fillColor = hexToRgb(currentOptions.pillColor);
            console.log('🎨 Custom pill color applied:');
            console.log('  Input:', currentOptions.pillColor);
            console.log('  RGB:', fillColor);
            console.log('  Original color:', originalColor);
        }
        else {
            console.log('Using original text color:', fillColor);
        }
        // Generate unique group ID for this text node's pills
        const groupId = `text-${textNode.id}-${Date.now()}`;
        // Get line height
        let lineHeightValue;
        const lineHeight = textNode.lineHeight;
        if (lineHeight === figma.mixed) {
            // Mixed line height, use default
            lineHeightValue = textNode.fontSize * 1.2;
        }
        else if (lineHeight.unit === 'PIXELS') {
            lineHeightValue = lineHeight.value;
        }
        else if (lineHeight.unit === 'PERCENT') {
            const fontSize = textNode.fontSize;
            lineHeightValue = (fontSize * lineHeight.value) / 100;
        }
        else {
            // AUTO or other
            lineHeightValue = textNode.fontSize * 1.2;
        }
        console.log(`Text node line height: ${lineHeightValue}px`);
        // Calculate number of lines based on text height and line height
        const totalHeight = textNode.height;
        const estimatedLines = Math.max(1, Math.round(totalHeight / lineHeightValue));
        console.log(`Text has ~${estimatedLines} line(s) (height: ${totalHeight}, lineHeight: ${lineHeightValue})`);
        // Create pills for each line
        for (let i = 0; i < estimatedLines; i++) {
            const lineWidth = Math.max(textNode.width, 20);
            let pillHeight = Math.max(lineHeightValue, 10);
            // Apply height adjustment from options
            if (currentOptions.heightAdjust !== 0) {
                const adjustment = 1 + (currentOptions.heightAdjust / 100);
                pillHeight = pillHeight * adjustment;
            }
            // Calculate vertical position for this line
            const lineY = y + (i * lineHeightValue);
            // Determine how many pills (words) to create for this line
            let numPills;
            let lineWidthMultiplier = 1.0;
            if (!currentOptions.multiplePills) {
                // Single pill mode: always 1 pill per line at 100% width
                numPills = 1;
                lineWidthMultiplier = 1.0;
            }
            else {
                // Multiple pills mode: random pills per line
                if (estimatedLines === 1) {
                    // Single line: 1-4 pills
                    numPills = Math.floor(Math.random() * 4) + 1;
                }
                else if (i === estimatedLines - 1) {
                    // Last line: typically shorter with fewer pills (1-3 pills, 50-75% width)
                    numPills = Math.floor(Math.random() * 3) + 1;
                    lineWidthMultiplier = 0.5 + Math.random() * 0.25;
                }
                else {
                    // Middle lines: 2-5 pills, 85-100% width
                    numPills = Math.floor(Math.random() * 4) + 2;
                    lineWidthMultiplier = 0.85 + Math.random() * 0.15;
                }
            }
            const availableWidth = lineWidth * lineWidthMultiplier;
            const gapBetweenPills = 6; // Space between pills to simulate word spacing
            const totalGapWidth = gapBetweenPills * (numPills - 1);
            const widthForPills = availableWidth - totalGapWidth;
            console.log(`  Line ${i + 1}: ${numPills} pills, width=${availableWidth.toFixed(1)}`);
            // Create random widths for each pill (simulating different word lengths)
            const pillWidths = [];
            let totalWeight = 0;
            for (let j = 0; j < numPills; j++) {
                // Random weight between 0.4 and 1.5 (short to long words)
                const weight = 0.4 + Math.random() * 1.1;
                pillWidths.push(weight);
                totalWeight += weight;
            }
            // Normalize widths to fit available space
            let currentX = x;
            for (let j = 0; j < numPills; j++) {
                const normalizedWidth = (pillWidths[j] / totalWeight) * widthForPills;
                const pillWidth = Math.max(normalizedWidth, 10); // Minimum width
                // Create pill shape data
                shapes.push({
                    x: currentX,
                    y: lineY,
                    width: pillWidth,
                    height: pillHeight,
                    fill: {
                        type: 'SOLID',
                        color: fillColor,
                        opacity: originalOpacity
                    },
                    cornerRadius: pillHeight / 2, // Pill effect
                    name: 'Pill',
                    groupId: groupId // Group pills from same text node
                });
                // Move X position for next pill
                currentX += pillWidth + gapBetweenPills;
            }
        }
    }
    catch (error) {
        console.error('Error handling text node:', error);
    }
}
// ============================================
// UTILITY FUNCTIONS
// ============================================
function findRootFrame(node) {
    let current = node;
    let lastFrame = null;
    // Walk up the tree until we hit the page
    while (current.parent && current.parent.type !== 'PAGE') {
        current = current.parent;
        // Keep track of the last frame we encountered
        if (current.type === 'FRAME' || current.type === 'COMPONENT' || current.type === 'INSTANCE') {
            lastFrame = current;
        }
    }
    return lastFrame;
}
async function copySelection() {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
        figma.notify('⚠️ Please select elements to copy');
        return;
    }
    // Clear previous copied nodes
    copiedNodes = [];
    // Store each node with its absolute position and ROOT frame position
    for (const node of selection) {
        const bounds = node.absoluteBoundingBox;
        if (!bounds)
            continue;
        // Find the root frame (top-level container)
        const rootFrame = findRootFrame(node);
        let rootFrameX = 0;
        let rootFrameY = 0;
        if (rootFrame && 'absoluteBoundingBox' in rootFrame) {
            const rootBounds = rootFrame.absoluteBoundingBox;
            if (rootBounds) {
                rootFrameX = rootBounds.x;
                rootFrameY = rootBounds.y;
                console.log(`Found root frame: ${rootFrame.name} at (${rootFrameX}, ${rootFrameY})`);
            }
        }
        else {
            console.log(`No root frame found for ${node.name}, using page coordinates`);
        }
        const relativeX = bounds.x - rootFrameX;
        const relativeY = bounds.y - rootFrameY;
        console.log(`Copying ${node.name}:`);
        console.log(`  Absolute: (${bounds.x}, ${bounds.y})`);
        console.log(`  Root frame: (${rootFrameX}, ${rootFrameY})`);
        console.log(`  Relative to root: (${relativeX}, ${relativeY})`);
        copiedNodes.push({
            node: node,
            absoluteX: bounds.x,
            absoluteY: bounds.y,
            parentAbsoluteX: rootFrameX,
            parentAbsoluteY: rootFrameY
        });
    }
    console.log('Copied nodes:', copiedNodes);
    figma.notify(`📋 Copied ${copiedNodes.length} element(s) - Now select destination frame and click "Paste Here"`);
    // Update UI status
    figma.ui.postMessage({
        type: 'update-status',
        text: `${copiedNodes.length} item(s) copied - Select destination & click Paste`
    });
}
async function pasteSelection() {
    if (copiedNodes.length === 0) {
        figma.notify('⚠️ Nothing to paste - Copy something first');
        return;
    }
    const selection = figma.currentPage.selection;
    if (selection.length !== 1) {
        figma.notify('⚠️ Please select exactly 1 destination frame');
        return;
    }
    const destination = selection[0];
    // Check if destination is a container
    if (!('appendChild' in destination)) {
        figma.notify('⚠️ Destination must be a frame or group');
        return;
    }
    const destBounds = destination.absoluteBoundingBox;
    if (!destBounds) {
        figma.notify('⚠️ Could not get destination bounds');
        return;
    }
    console.log('Pasting into:', destination.name, 'at', destBounds.x, destBounds.y);
    console.log('Destination type:', destination.type);
    console.log('Destination has auto layout:', 'layoutMode' in destination ? destination.layoutMode : 'N/A');
    const pastedNodes = [];
    // Clone and paste each node
    for (const item of copiedNodes) {
        if (!('clone' in item.node))
            continue;
        const clone = item.node.clone();
        // Calculate the relative position within the original parent
        const relativeXInOriginal = item.absoluteX - item.parentAbsoluteX;
        const relativeYInOriginal = item.absoluteY - item.parentAbsoluteY;
        console.log(`\n--- Pasting ${clone.name} ---`);
        console.log(`  Original absolute position: (${item.absoluteX}, ${item.absoluteY})`);
        console.log(`  Original parent position: (${item.parentAbsoluteX}, ${item.parentAbsoluteY})`);
        console.log(`  Relative in original parent: (${relativeXInOriginal}, ${relativeYInOriginal})`);
        console.log(`  Destination frame position: (${destBounds.x}, ${destBounds.y})`);
        console.log(`  Setting clone.x = ${relativeXInOriginal}, clone.y = ${relativeYInOriginal}`);
        // Apply the same relative position in the destination frame
        clone.x = relativeXInOriginal;
        clone.y = relativeYInOriginal;
        destination.appendChild(clone);
        // Check actual position after appending
        const cloneBounds = clone.absoluteBoundingBox;
        if (cloneBounds) {
            console.log(`  ✓ Clone actual absolute position after paste: (${cloneBounds.x}, ${cloneBounds.y})`);
            console.log(`  ✓ Clone actual relative position: (${clone.x}, ${clone.y})`);
        }
        pastedNodes.push(clone);
    }
    figma.currentPage.selection = pastedNodes;
    figma.notify(`📌 Pasted ${pastedNodes.length} element(s) into ${destination.name}`);
    // Update UI status
    figma.ui.postMessage({
        type: 'update-status',
        text: `Pasted ${pastedNodes.length} item(s)`
    });
}
async function flattenAndMerge() {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
        figma.notify('⚠️ Please select elements to flatten');
        return;
    }
    try {
        // First flatten all selected nodes
        const flattened = figma.flatten(selection);
        if (!flattened) {
            figma.notify('⚠️ Could not flatten selection');
            return;
        }
        figma.currentPage.selection = [flattened];
        figma.notify(`🔲 Flattened and merged ${selection.length} element(s)`);
    }
    catch (error) {
        console.error('Flatten error:', error);
        figma.notify('❌ Error: Could not flatten selection. Make sure all items are on the same level.');
    }
}
async function groupByColor() {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
        figma.notify('⚠️ Please select elements to group by color');
        return;
    }
    // Map to store nodes by color hex
    const colorGroups = new Map();
    // Analyze each node and extract color
    for (const node of selection) {
        let colorHex = 'No Fill';
        if ('fills' in node && Array.isArray(node.fills) && node.fills.length > 0) {
            const firstFill = node.fills[0];
            if (firstFill.type === 'SOLID') {
                colorHex = rgbToHex(firstFill.color);
            }
            else if (firstFill.type === 'IMAGE') {
                colorHex = 'Image Fill';
            }
            else {
                colorHex = firstFill.type;
            }
        }
        if (!colorGroups.has(colorHex)) {
            colorGroups.set(colorHex, []);
        }
        colorGroups.get(colorHex).push(node);
    }
    console.log('Color groups:', colorGroups);
    // Create a group for each color
    const newGroups = [];
    for (const [colorHex, nodes] of colorGroups.entries()) {
        if (nodes.length === 0)
            continue;
        // Create group
        const group = figma.group(nodes, figma.currentPage);
        group.name = colorHex;
        newGroups.push(group);
        console.log(`Created group "${colorHex}" with ${nodes.length} items`);
    }
    figma.currentPage.selection = newGroups;
    figma.notify(`🎨 Created ${newGroups.length} color group(s)`);
}
async function convertFrameToShape() {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
        figma.notify('⚠️ Please select elements to convert');
        return;
    }
    const createdShapes = [];
    for (const node of selection) {
        const parent = node.parent;
        if (!parent || !('appendChild' in parent)) {
            console.log(`Skipping ${node.name} - no valid parent`);
            continue;
        }
        const bounds = node.absoluteBoundingBox;
        if (!bounds) {
            console.log(`Skipping ${node.name} - no bounds`);
            continue;
        }
        console.log(`Converting ${node.type}: ${node.name}`);
        console.log(`  Absolute position: (${bounds.x}, ${bounds.y})`);
        console.log(`  Size: ${bounds.width}x${bounds.height}`);
        // Create rectangle shape with the same dimensions
        const shape = figma.createRectangle();
        shape.name = `${node.name} (Shape)`;
        // Set size
        shape.resize(bounds.width, bounds.height);
        // Copy fills
        if ('fills' in node && Array.isArray(node.fills)) {
            shape.fills = [...node.fills];
            console.log(`  Copied fills:`, shape.fills);
        }
        // Copy strokes
        if ('strokes' in node && Array.isArray(node.strokes)) {
            shape.strokes = [...node.strokes];
            console.log(`  Copied strokes:`, shape.strokes);
        }
        if ('strokeWeight' in node && typeof node.strokeWeight === 'number') {
            shape.strokeWeight = node.strokeWeight;
        }
        if ('strokeAlign' in node) {
            shape.strokeAlign = node.strokeAlign;
        }
        // Copy effects
        if ('effects' in node && Array.isArray(node.effects)) {
            shape.effects = [...node.effects];
            console.log(`  Copied effects:`, shape.effects);
        }
        // Copy opacity
        if ('opacity' in node) {
            shape.opacity = node.opacity;
            console.log(`  Copied opacity:`, node.opacity);
        }
        // Copy corner radius
        if ('cornerRadius' in node && typeof node.cornerRadius === 'number') {
            shape.cornerRadius = node.cornerRadius;
            console.log(`  Copied corner radius:`, node.cornerRadius);
        }
        else if ('topLeftRadius' in node) {
            // Handle individual corner radii
            if (typeof node.topLeftRadius === 'number')
                shape.topLeftRadius = node.topLeftRadius;
            if (typeof node.topRightRadius === 'number')
                shape.topRightRadius = node.topRightRadius;
            if (typeof node.bottomLeftRadius === 'number')
                shape.bottomLeftRadius = node.bottomLeftRadius;
            if (typeof node.bottomRightRadius === 'number')
                shape.bottomRightRadius = node.bottomRightRadius;
        }
        // Copy blend mode
        if ('blendMode' in node) {
            shape.blendMode = node.blendMode;
        }
        // Copy stroke cap and join
        if ('strokeCap' in node) {
            shape.strokeCap = node.strokeCap;
        }
        if ('strokeJoin' in node) {
            shape.strokeJoin = node.strokeJoin;
        }
        if ('dashPattern' in node && Array.isArray(node.dashPattern)) {
            shape.dashPattern = [...node.dashPattern];
        }
        // Add to parent first
        parent.appendChild(shape);
        // Set position using the same coordinates as the original node
        shape.x = node.x;
        shape.y = node.y;
        console.log(`  Created shape at (${shape.x}, ${shape.y})`);
        // Verify final position
        const shapeBounds = shape.absoluteBoundingBox;
        if (shapeBounds) {
            console.log(`  ✓ Shape absolute position: (${shapeBounds.x}, ${shapeBounds.y})`);
            console.log(`  ✓ Expected: (${bounds.x}, ${bounds.y})`);
            console.log(`  ✓ Match: ${Math.abs(shapeBounds.x - bounds.x) < 0.01 && Math.abs(shapeBounds.y - bounds.y) < 0.01 ? 'YES' : 'NO'}`);
        }
        createdShapes.push(shape);
    }
    if (createdShapes.length > 0) {
        figma.currentPage.selection = createdShapes;
        figma.notify(`🔷 Converted ${createdShapes.length} element(s) to shape(s)`);
    }
    else {
        figma.notify('⚠️ Could not convert selection');
    }
}
// ============================================
// HELPER FUNCTIONS
// ============================================
function hexToRgb(hex) {
    // Remove # and trim whitespace
    hex = hex.replace('#', '').trim().toUpperCase();
    // Handle 3-character hex codes (e.g., "FFF" -> "FFFFFF")
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    // Validate hex format (should be 6 characters)
    if (hex.length !== 6 || !/^[0-9A-F]{6}$/.test(hex)) {
        console.warn(`Invalid hex color: ${hex}, using default gray`);
        return { r: 0.85, g: 0.85, b: 0.85 };
    }
    // Parse hex values
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    return { r, g, b };
}
function rgbToHex(rgb) {
    const r = Math.round(rgb.r * 255).toString(16).padStart(2, '0');
    const g = Math.round(rgb.g * 255).toString(16).padStart(2, '0');
    const b = Math.round(rgb.b * 255).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`.toUpperCase();
}
function isShape(node) {
    return node.type === 'RECTANGLE' ||
        node.type === 'ELLIPSE' ||
        node.type === 'POLYGON' ||
        node.type === 'STAR' ||
        node.type === 'VECTOR';
}
function isContainer(node) {
    return node.type === 'FRAME' ||
        node.type === 'GROUP' ||
        node.type === 'COMPONENT' ||
        node.type === 'INSTANCE';
}
