const COLOR_MAP = { '북': '#ef4444', '남': '#3b82f6', '동': '#22c55e', '서': '#eab308' };
const DIR_CHARS = '북남동서';
const PALETTE = [
    '#ef4444', // 빨강  (북 기본)
    '#3b82f6', // 파랑  (남 기본)
    '#22c55e', // 초록  (동 기본)
    '#eab308', // 노랑  (서 기본)
];

function findDirChars(name) {
    return [...name].filter(c => DIR_CHARS.includes(c));
}

function getDirectionColor(name, allNames) {
    const firstDirChars = allNames.map(n => findDirChars(n)[0]).filter(Boolean);
    const duplicateFirsts = new Set(
        firstDirChars.filter((c, i) => firstDirChars.indexOf(c) !== i)
    );
    const dirChars = findDirChars(name);
    if (!dirChars.length) return '#94a3b8';
    const useChar = (duplicateFirsts.has(dirChars[0]) && dirChars[1]) ? dirChars[1] : dirChars[0];
    return COLOR_MAP[useChar] || '#94a3b8';
}

function assignApproachColors(approaches) {
    const names = approaches.map(a => a.name);
    const result = new Map();
    const usedColors = new Set();

    for (const ap of approaches) {
        const color = getDirectionColor(ap.name, names);
        if (color !== '#94a3b8' && !usedColors.has(color)) {
            result.set(ap.acsrId, color);
            usedColors.add(color);
        } else {
            result.set(ap.acsrId, null);
        }
    }

    let pi = 0;
    for (const ap of approaches) {
        if (result.get(ap.acsrId) === null) {
            while (pi < PALETTE.length && usedColors.has(PALETTE[pi])) pi++;
            const fallback = pi < PALETTE.length ? PALETTE[pi++] : '#94a3b8';
            result.set(ap.acsrId, fallback);
            usedColors.add(fallback);
        }
    }
    return result;
}

const approaches = [
    { acsrId: 1, name: '서(동향)' },
    { acsrId: 2, name: '동(서향)' },
    { acsrId: 3, name: '남(북향)' },
    { acsrId: 4, name: '북(남향)' },
];

const res = assignApproachColors(approaches);
for (const a of approaches) {
    console.log(a.name, res.get(a.acsrId));
}
