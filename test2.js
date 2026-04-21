const DIR_CHARS = '북남동서';
const COLOR_MAP = { '북': '#ef4444', '남': '#3b82f6', '동': '#22c55e', '서': '#eab308' };

const PALETTE = [
    '#ef4444', // 빨강
    '#3b82f6', // 파랑
    '#22c55e', // 초록
    '#eab308', // 노랑
    '#8b5cf6', // 보라
    '#06b6d4', // 시안
];

function assignApproachColors(approaches) {
    const result = new Map();
    const usedColors = new Set();

    for (const ap of approaches) {
        const dirChars = [...ap.name].filter(c => DIR_CHARS.includes(c));
        let assigned = false;

        for (const char of dirChars) {
            const color = COLOR_MAP[char];
            if (color && !usedColors.has(color)) {
                result.set(ap.acsrId, color);
                usedColors.add(color);
                assigned = true;
                break;
            }
        }

        if (!assigned) {
            result.set(ap.acsrId, null);
        }
    }

    let pi = 0;
    for (const ap of approaches) {
        if (result.get(ap.acsrId) === null) {
            while (pi < PALETTE.length && usedColors.has(PALETTE[pi])) {
                pi++;
            }
            if (pi < PALETTE.length) {
                const fallback = PALETTE[pi];
                result.set(ap.acsrId, fallback);
                usedColors.add(fallback);
                pi++;
            } else {
                result.set(ap.acsrId, '#94a3b8');
            }
        }
    }

    return result;
}

const approaches = [
    { acsrId: 1, name: '남부천신협앞-북(남향)' },
    { acsrId: 2, name: '남부천신협앞-서(동향)' },
    { acsrId: 3, name: '남부천신협앞-동(서향)' },
    { acsrId: 4, name: '남부천신협앞-남(북향)' },
];

const res = assignApproachColors(approaches);
console.log(approaches.map(a => `${a.name}: ${res.get(a.acsrId)}`));
