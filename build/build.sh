#!/usr/bin/env bash
# ============================================================
#  Byte Blaster - Build Menu (Linux / macOS)
#
#  Mirrors build/build.bat: asks for the target and the edition
#  (full game / demo / both) up front, then builds unattended.
#  Editions write to separate dist/ folders, so building both in
#  one run never overwrites anything. See docs/BUILD_GUIDE.md.
# ============================================================
set -e
# This script lives in build/ — operate from the project root (one level up).
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js was not found in PATH."
    echo "Install Node.js LTS from https://nodejs.org/ and try again."
    exit 1
fi

echo ""
echo "============================================================"
echo "  Byte Blaster - Build Menu"
echo "============================================================"
echo ""
echo "Select build type:"
echo "  1. Steam version (.exe / .AppImage / .dmg)"
echo "  2. HTML version (web)"
echo "  3. Both versions"
echo "  4. Exit"
echo ""
read -r -p "Enter your choice (1-4): " choice
case "$choice" in
    1|2|3) ;;
    4) echo "Exiting."; exit 0 ;;
    *)  echo "Invalid choice. Exiting."; exit 1 ;;
esac

echo ""
echo "Which edition?"
echo "  1. Full game  (all 110 levels, every mode)"
echo "  2. Demo       (first levels only; infinite, hardcore,"
echo "                 2-player and online are locked)"
echo "  3. Both       (full first, then demo)"
echo ""
read -r -p "Enter your choice (1-3, default 1): " echoice
case "$echoice" in
    2) EDITIONS="demo" ;;
    3) EDITIONS="full demo" ;;
    *) EDITIONS="full" ;;
esac

DEMO_LEVELS=10
DEMO_URL=""
case "$EDITIONS" in
    *demo*)
        echo ""
        read -r -p "How many levels does the demo include [10]: " ans
        [ -n "$ans" ] && DEMO_LEVELS="$ans"
        echo "The end-of-demo screen can show a \"get the full version\" button."
        echo "Leave blank for no button - the text still tells the player to get it."
        read -r -p "Full-version store URL (https://... or blank): " DEMO_URL
        ;;
esac

if [ ! -d "node_modules" ]; then
    echo ""
    echo "Installing dependencies (first run)..."
    npm install --no-audit --no-fund
fi

for ED in $EDITIONS; do
    echo ""
    echo "============================================================"
    echo "  EDITION: $ED"
    echo "============================================================"
    if [ "$ED" = "demo" ]; then
        node build/set-edition.js demo "$DEMO_URL" "$DEMO_LEVELS"
        NAME="Byte Blaster Demo"
    else
        node build/set-edition.js full
        NAME="Byte Blaster"
    fi

    case "$choice" in
        1) npm run build:steam ;;
        2) npm run build:html ;;
        3) npm run build:steam; npm run build:html ;;
    esac

    echo ""
    [ "$choice" != "2" ] && echo "Steam output: dist/$NAME (Steam)/"
    [ "$choice" != "1" ] && echo "HTML output:  dist/$NAME (HTML)/"
done

# Leave the working tree on the FULL game: otherwise `npm start` after a demo
# build would silently run the cut-down version.
node build/set-edition.js full >/dev/null

echo ""
echo "============================================================"
echo "  ALL BUILDS COMPLETE"
echo "============================================================"
ls -lh dist/ 2>/dev/null | tail -n +2 || true
echo ""
