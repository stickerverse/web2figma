#!/bin/bash
# Apply P0-1 patch: Fix IMAGE node asset linking

set -e

echo "=========================================="
echo "P0-1: Fixing IMAGE Asset Linking"
echo "=========================================="

REPO_ROOT="/Users/skirk92/figmacionvert-2"
TARGET_FILE="$REPO_ROOT/chrome-extension/src/utils/dom-extractor.ts"

echo ""
echo "Target file: $TARGET_FILE"

# Backup original
cp "$TARGET_FILE" "${TARGET_FILE}.backup-$(date +%Y%m%d-%H%M%S)"
echo "✅ Created backup: ${TARGET_FILE}.backup-*"

# Find exact line numbers
echo ""
echo "Finding target code locations..."
LINE_KEY=$(grep -n "const key = this.hashString(imageUrl);" "$TARGET_FILE" | head -1 | cut -d: -f1)
LINE_FILL=$(grep -n 'imageHash: key,' "$TARGET_FILE" | head -1 | cut -d: -f1)
LINE_NODE_HASH=$(grep -n 'node.imageHash = key;' "$TARGET_FILE" | head -1 | cut -d: -f1)

echo "  const key declaration: line $LINE_KEY"
echo "  fills imageHash: line $LINE_FILL"
echo "  node.imageHash assignment: line $LINE_NODE_HASH"

if [ -z "$LINE_KEY" ] || [ -z "$LINE_FILL" ] || [ -z "$LINE_NODE_HASH" ]; then
  echo "❌ ERROR: Could not find target lines. File may have been modified."
  exit 1
fi

# Apply fixes
echo ""
echo "Applying fixes..."

# Fix 1: Add assetId constant after key declaration
sed -i.tmp "${LINE_KEY}a\\
      const assetId = \`img_\${key}\`;  // CRITICAL FIX: Match assets.images key format
" "$TARGET_FILE"
rm "${TARGET_FILE}.tmp"
echo "  ✅ Added assetId constant"

# Fix 2: Change fills imageHash from 'key' to 'assetId'
# Need to recalculate line number after previous insert
LINE_FILL=$(grep -n 'imageHash: key,' "$TARGET_FILE" | head -1 | cut -d: -f1)
sed -i.tmp "${LINE_FILL}s/imageHash: key,/imageHash: assetId,  \/\/ CHANGED: Use prefixed assetId/" "$TARGET_FILE"
rm "${TARGET_FILE}.tmp"
echo "  ✅ Fixed fills imageHash"

# Fix 3: Change node.imageHash from 'key' to 'assetId'  
LINE_NODE_HASH=$(grep -n 'node.imageHash = key;' "$TARGET_FILE" | head -1 | cut -d: -f1)
sed -i.tmp "${LINE_NODE_HASH}s/node.imageHash = key;/node.imageHash = assetId;  \/\/ CHANGED: Use prefixed assetId/" "$TARGET_FILE"
rm "${TARGET_FILE}.tmp"
echo "  ✅ Fixed node.imageHash"

# Fix 4: Add node.imageAssetId line
sed -i.tmp "${LINE_NODE_HASH}a\\
      node.imageAssetId = assetId;   // NEW: Figma plugin compatibility
" "$TARGET_FILE"
rm "${TARGET_FILE}.tmp"
echo "  ✅ Added node.imageAssetId"

echo ""
echo "=========================================="
echo "Patch applied successfully!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Review changes: diff ${TARGET_FILE}.backup-* ${TARGET_FILE}"
echo "  2. Rebuild: cd chrome-extension && npm run build"
echo "  3. Test: Reload extension, capture github.com"
echo "  4. Verify: jq '[.captures[0].data.root] | .. | objects | select(.type == \"IMAGE\") | .imageAssetId' schema.json"
echo ""
