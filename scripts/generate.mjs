// Draws every image in assets/ from live GitHub data, with no third-party image services.
// Run: GITHUB_TOKEN=$(gh auth token) node scripts/generate.mjs
//
// All data is fetched before anything is written, so a failed API call leaves
// the previous images in place instead of publishing a half-updated profile.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOGIN = 'KrishnaHendra';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets');
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error('GITHUB_TOKEN is required');

const ICONS = JSON.parse(readFileSync(join(ROOT, 'scripts/icons.json'), 'utf8'));
const fontData = (file) => readFileSync(join(ROOT, 'scripts/fonts', file)).toString('base64');
const DISPLAY_FONT = `@font-face{font-family:D;font-weight:700;src:url(data:font/woff2;base64,${fontData('display.woff2')}) format("woff2")}`;
const MONO_FONT = `@font-face{font-family:M;font-weight:500;src:url(data:font/woff2;base64,${fontData('mono.woff2')}) format("woff2")}`;
const SANS = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

const THEMES = {
    dark: {
        surface: '#11161d', line: '#2a333f', ink: '#e6edf3', muted: '#9aa7b4', accent: '#2dd4bf',
        heat: ['#1b232d', '#134e4a', '#0f766e', '#14b8a6', '#5eead4'],
        heroTop: '#0b1118', heroBottom: '#0d1b20', glow: '#14b8a6', termBg: '#0a0f14', termBar: '#161d25', dot: '#ffffff',
    },
    light: {
        surface: '#f6f8fa', line: '#d0d7de', ink: '#1f2328', muted: '#59636e', accent: '#0f766e',
        heat: ['#ebeff2', '#99f6e4', '#2dd4bf', '#0d9488', '#115e59'],
        heroTop: '#f4fbfa', heroBottom: '#e6f6f3', glow: '#5eead4', termBg: '#ffffff', termBar: '#eef2f5', dot: '#0f172a',
    },
};

const TECH = [
    ['Languages', ['PHP', 'JavaScript', 'TypeScript', 'Dart']],
    ['Frontend', ['React', 'Vite', 'Tailwind CSS', 'Sass', 'Webpack']],
    ['Backend', ['Laravel', 'CodeIgniter', 'Node.js', 'Hapi', 'Express']],
    ['Mobile', ['Flutter']],
    ['Data', ['PostgreSQL', 'MySQL', 'Redis', 'RabbitMQ']],
    ['Tools', ['Git', 'GitHub']],
];

// Wording and stack are curated; star counts come from the API.
const PROJECTS = [
    { repo: 'notes-app', title: 'Notes API', text: 'Backend for a notes app, with JWT auth, background jobs over a message queue, caching and file storage.', tags: ['Hapi', 'PostgreSQL', 'Redis', 'RabbitMQ'] },
    { repo: 'gapyeong-loyalty-app', title: 'Gapyeong Loyalty', text: 'Loyalty app for Gapyeong Korean BBQ, a Korean BBQ restaurant group in Indonesia.', tags: ['Laravel', 'PHP'] },
    { repo: 'citycareapp', title: 'CityCare', text: 'Installable web app that lets residents report damaged public facilities directly to the city government.', tags: ['JavaScript', 'PWA', 'Leaflet'] },
    { repo: 'KamoFlutter', title: 'Kantin Moklet', text: 'Mobile app for digital payments at the Moklet school canteen.', tags: ['Flutter', 'Dart'] },
    { repo: 'simasko', title: 'SIMASKO', text: 'Information system for a Balai Latihan Kerja, an Indonesian vocational training center.', tags: ['Laravel', 'PHP'] },
    { repo: 'personal-notes-app', title: 'Personal Notes', text: 'Notes app with archiving and quick search, built with modern React.', tags: ['React', 'Vite'] },
];

// Page markup dwarfs real code in these repos, so it would hide the language each one is really written in.
const NOT_CODE = new Set(['HTML', 'CSS', 'SCSS', 'Less', 'EJS', 'Blade', 'MDX', 'TSQL', 'Hack', 'TeX']);

/* ---------- data ---------- */

async function api(path, options = {}) {
    const res = await fetch(`https://api.github.com${path}`, {
        ...options,
        headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': LOGIN, Accept: 'application/vnd.github+json', ...options.headers },
    });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
}

async function loadData() {
    const user = await api(`/users/${LOGIN}`);
    const repos = [];
    for (let page = 1; ; page++) {
        const batch = await api(`/users/${LOGIN}/repos?per_page=100&type=owner&page=${page}`);
        repos.push(...batch);
        if (batch.length < 100) break;
    }
    const own = repos.filter((r) => !r.fork);

    // Counting repos, not bytes: bundled libraries would otherwise outweigh everything I wrote.
    const repoCounts = {};
    for (const repo of own) {
        const languages = await api(`/repos/${LOGIN}/${repo.name}/languages`);
        const [main] = Object.entries(languages).filter(([name]) => !NOT_CODE.has(name)).sort((a, b) => b[1] - a[1]);
        if (main) repoCounts[main[0]] = (repoCounts[main[0]] || 0) + 1;
    }

    const graph = await api('/graphql', {
        method: 'POST',
        body: JSON.stringify({
            query: `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{
                totalContributions weeks{contributionDays{date contributionCount contributionLevel}}}}}}`,
            variables: { login: LOGIN },
        }),
    });
    if (graph.errors) throw new Error(JSON.stringify(graph.errors));
    const calendar = graph.data.user.contributionsCollection.contributionCalendar;

    const days = calendar.weeks.flatMap((w) => w.contributionDays);
    let longest = 0, run = 0;
    for (const day of days) {
        run = day.contributionCount > 0 ? run + 1 : 0;
        longest = Math.max(longest, run);
    }
    // Today still counts as "in progress", so an empty today does not end the streak.
    let current = 0;
    for (let i = days.length - 1; i >= 0; i--) {
        if (days[i].contributionCount > 0) current++;
        else if (i !== days.length - 1) break;
    }

    const ranked = Object.entries(repoCounts).sort((a, b) => b[1] - a[1]);
    const languages = ranked.slice(0, 5).map(([name, count]) => ({ name, count }));
    const rest = ranked.slice(5).reduce((sum, [, count]) => sum + count, 0);
    if (rest > 0) languages.push({ name: 'Other', count: rest });

    return {
        repos: user.public_repos,
        since: new Date(user.created_at).getUTCFullYear(),
        stars: own.reduce((sum, r) => sum + r.stargazers_count, 0),
        starsByRepo: Object.fromEntries(repos.map((r) => [r.name, r.stargazers_count])),
        contributions: calendar.totalContributions,
        weeks: calendar.weeks,
        longest,
        current,
        languages,
    };
}

/* ---------- drawing helpers ---------- */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => n.toLocaleString('en-US');
const svg = (w, h, title, body, style = '') =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><style>${style}</style>${body}</svg>\n`;
const panel = (w, h, t) => `<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="16" fill="${t.surface}" stroke="${t.line}"/>`;
const label = (x, y, text, t, size = 13, extra = '') => `<text x="${x}" y="${y}" fill="${t.muted}" font-family="${SANS}" font-size="${size}" ${extra}>${esc(text)}</text>`;

function wrap(text, max) {
    const lines = [''];
    for (const word of text.split(' ')) {
        const line = lines[lines.length - 1];
        if ((line + ' ' + word).trim().length > max) lines.push(word);
        else lines[lines.length - 1] = (line + ' ' + word).trim();
    }
    return lines;
}

function luminance(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Brand colors that would vanish on this surface (Express is black, say) fall back to ink.
function iconColor(hex, t) {
    const [a, b] = [luminance(hex), luminance(t.surface)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05) >= 3.2 ? hex : t.ink;
}

/* ---------- images ---------- */

function hero(t) {
    const lines = [
        ['make it work', 12, 26],
        ['make it right', 28, 42],
        ['make it fast', 44, 58],
    ];
    const rows = lines.map(([text, start, done], i) => {
        const y = 142 + i * 40;
        return `<g class="row r${i}">
            <circle cx="14" cy="${y - 5}" r="9" class="ring"/>
            <path d="M9.5 ${y - 5}l3 3 6-6.5" class="tick k${i}"/>
            <text x="34" y="${y}" class="mono ink">${text}</text>
            <rect x="196" y="${y - 10}" width="100" height="8" rx="4" class="track"/>
            <rect x="196" y="${y - 10}" width="100" height="8" rx="4" class="fill f${i}"/>
        </g>`;
    }).join('');
    const stages = lines.map(([, start, done], i) => `
        .r${i}{animation:r${i} 11s infinite both}
        .f${i}{transform-box:fill-box;transform-origin:left;animation:f${i} 11s infinite both}
        .k${i}{animation:k${i} 11s infinite both}
        @keyframes r${i}{0%,${start}%{opacity:0;transform:translateY(8px)}${start + 4}%,94%{opacity:1;transform:none}100%{opacity:0}}
        @keyframes f${i}{0%,${start}%{transform:scaleX(0)}${done}%,100%{transform:none}}
        @keyframes k${i}{0%,${done}%{opacity:0}${done + 2}%,100%{opacity:1}}`).join('');

    const style = `${DISPLAY_FONT}${MONO_FONT}
        .name{font:700 62px D,${SANS};letter-spacing:-1.8px;fill:${t.ink}}
        .accent{fill:${t.accent}}
        .role{font:500 21px ${SANS};fill:${t.ink}}
        .place{font:400 17px ${SANS};fill:${t.muted}}
        .mono{font:500 16px M,ui-monospace,Menlo,monospace}
        .ink{fill:${t.ink}}
        .muted{fill:${t.muted}}
        .ring{fill:none;stroke:${t.line};stroke-width:1.5}
        .tick{fill:none;stroke:${t.accent};stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
        .track{fill:${t.line}}
        .fill{fill:${t.accent}}
        .glow{animation:drift 14s ease-in-out infinite alternate}
        .glow2{animation:drift 18s ease-in-out infinite alternate-reverse}
        .caret{animation:blink 1.1s steps(1) infinite}
        .enter{animation:enter .9s cubic-bezier(.2,.7,.2,1) both}
        .e2{animation-delay:.12s}.e3{animation-delay:.24s}.e4{animation-delay:.36s}
        @keyframes drift{to{transform:translate(70px,26px) scale(1.18)}}
        @keyframes blink{50%{opacity:0}}
        @keyframes enter{from{opacity:0;transform:translateY(14px)}}
        ${stages}
        @media (prefers-reduced-motion:reduce){*{animation:none!important}}`;

    const dots = Array.from({ length: 12 }, (_, row) => Array.from({ length: 34 }, (_, col) =>
        `<circle cx="${18 + col * 30}" cy="${18 + row * 30}" r="1"/>`).join('')).join('');

    const body = `
    <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.heroTop}"/><stop offset="1" stop-color="${t.heroBottom}"/></linearGradient>
        <radialGradient id="g"><stop offset="0" stop-color="${t.glow}" stop-opacity=".42"/><stop offset="1" stop-color="${t.glow}" stop-opacity="0"/></radialGradient>
        <clipPath id="c"><rect width="1000" height="360" rx="22"/></clipPath>
    </defs>
    <g clip-path="url(#c)">
        <rect width="1000" height="360" fill="url(#bg)"/>
        <g fill="${t.dot}" opacity=".07">${dots}</g>
        <circle class="glow" cx="760" cy="60" r="280" fill="url(#g)"/>
        <circle class="glow2" cx="120" cy="340" r="240" fill="url(#g)"/>
    </g>
    <rect x=".5" y=".5" width="999" height="359" rx="22" fill="none" stroke="${t.line}"/>
    <text x="52" y="86" class="mono accent enter">Hello, I'm</text>
    <text x="50" y="152" class="name enter e2">Krishna Hendra</text>
    <text x="50" y="218" class="name enter e2">Wijaya<tspan class="accent">.</tspan></text>
    <text x="52" y="268" class="role enter e3">Software Developer</text>
    <text x="52" y="300" class="place enter e4">Web, backend and mobile · Malang, Indonesia</text>
    <g transform="translate(606 52)">
        <rect width="344" height="256" rx="14" fill="${t.termBg}" stroke="${t.line}"/>
        <path d="M14 0h316a14 14 0 0 1 14 14v22H0V14A14 14 0 0 1 14 0z" fill="${t.termBar}"/>
        <circle cx="20" cy="18" r="5" fill="#ff5f57"/><circle cx="38" cy="18" r="5" fill="#febc2e"/><circle cx="56" cy="18" r="5" fill="#28c840"/>
        <text x="172" y="23" text-anchor="middle" class="muted" font-family="${SANS}" font-size="12.5">how-i-build</text>
        <g transform="translate(22 0)">
            <text y="74" class="mono"><tspan class="accent">$</tspan><tspan class="ink" dx="9">./ship next-feature</tspan></text>
            <g transform="translate(0 -30)">${rows}</g>
            <text y="232" class="mono"><tspan class="accent">$</tspan></text>
            <rect x="19" y="218" width="9" height="18" class="caret accent"/>
        </g>
    </g>`;
    return svg(1000, 360, 'Krishna Hendra Wijaya, Software Developer from Malang, Indonesia. Make it work, make it right, make it fast.', body, style);
}

function button(name, text, iconBody) {
    const width = 62 + text.length * 8.1;
    const body = `<rect width="${width}" height="40" rx="20" fill="#11161d" stroke="#2dd4bf"/>
        <svg x="17" y="11" width="18" height="18" viewBox="0 0 24 24" fill="#2dd4bf">${iconBody}</svg>
        <text x="44" y="25.5" fill="#e6edf3" font-family="${SANS}" font-size="14.5" font-weight="600">${esc(text)}</text>`;
    return [`btn-${name}.svg`, svg(width, 40, text, body)];
}

function techStack(t) {
    const rowHeight = 58, left = 118, gap = 10, width = 1000;
    let y = 24;
    const rows = TECH.map(([group, items]) => {
        let x = left;
        const chips = items.map((name) => {
            const icon = ICONS[name];
            const w = (icon ? 52 : 28) + name.length * 8.2;
            const chip = `<g transform="translate(${x} 0)"><rect width="${w}" height="40" rx="10" fill="${t.surface}" stroke="${t.line}"/>
                ${icon ? `<svg x="12" y="11" width="18" height="18" viewBox="0 0 24 24" fill="${iconColor(icon.hex, t)}"><path d="${icon.path}"/></svg>` : ''}
                <text x="${icon ? 38 : 13}" y="25" fill="${t.ink}" font-family="${SANS}" font-size="14" font-weight="500">${esc(name)}</text></g>`;
            x += w + gap;
            return chip;
        }).join('');
        const row = `<g transform="translate(0 ${y})">${label(2, 25, group, t, 13.5, 'font-weight="600"')}${chips}</g>`;
        y += rowHeight;
        return row;
    }).join('');
    return svg(width, y + 2, `Tech stack: ${TECH.map(([g, i]) => `${g}: ${i.join(', ')}`).join('. ')}`, rows);
}

function stats(d, t) {
    const tiles = [
        [num(d.contributions), 'Contributions, last 12 months'],
        [`${d.longest} days`, 'Longest streak'],
        [`${d.current} days`, 'Current streak'],
        [num(d.repos), 'Public repositories'],
        [num(d.stars), 'Stars earned'],
    ];
    const width = 1000, gap = 12, w = (width - gap * 4) / 5;
    const body = tiles.map(([value, name], i) => {
        const lines = wrap(name, 21);
        return `<g transform="translate(${i * (w + gap)} 0)"><rect x=".5" y=".5" width="${w - 1}" height="127" rx="14" fill="${t.surface}" stroke="${t.line}"/>
        <rect x="20" y="24" width="24" height="3" rx="1.5" fill="${t.accent}"/>
        <text x="20" y="66" fill="${t.ink}" font-family="D,${SANS}" font-weight="700" font-size="29">${esc(value)}</text>
        ${lines.map((line, n) => label(20, 90 + n * 17, line, t, 12.5)).join('')}</g>`;
    }).join('');
    return svg(width, 128, tiles.map(([v, n]) => `${n}: ${v}`).join('. '), body, DISPLAY_FONT);
}

function activity(d, t) {
    const cell = 14, gap = 3.5, step = cell + gap, x0 = 56, y0 = 72;
    const levels = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let lastMonth = -1, lastX = -99;
    let monthLabels = '', cells = '';
    d.weeks.forEach((week, col) => {
        const x = x0 + col * step;
        const first = new Date(`${week.contributionDays[0].date}T00:00:00Z`);
        if (first.getUTCMonth() !== lastMonth && x - lastX > 30 && first.getUTCDate() <= 7) {
            monthLabels += label(x, y0 - 12, months[first.getUTCMonth()], t, 12);
            lastMonth = first.getUTCMonth();
            lastX = x;
        }
        for (const day of week.contributionDays) {
            const row = new Date(`${day.date}T00:00:00Z`).getUTCDay();
            cells += `<rect x="${x}" y="${y0 + row * step}" width="${cell}" height="${cell}" rx="3.5" fill="${t.heat[levels[day.contributionLevel]]}"><title>${day.date}: ${day.contributionCount}</title></rect>`;
        }
    });
    const dayLabels = [['Mon', 1], ['Wed', 3], ['Fri', 5]].map(([n, row]) => label(22, y0 + row * step + 11, n, t, 12)).join('');
    const width = x0 + d.weeks.length * step + 20, base = y0 + 7 * step + 28;
    const legend = t.heat.map((color, i) => `<rect x="${width - 150 + i * 18}" y="${base - 11}" width="14" height="14" rx="3.5" fill="${color}"/>`).join('');
    const body = `${panel(width, base + 22, t)}
        <text x="22" y="30" fill="${t.ink}" font-family="${SANS}" font-weight="600" font-size="15">Contributions in the last 12 months</text>
        ${monthLabels}${dayLabels}${cells}
        ${label(width - 188, base, 'Less', t, 12)}${legend}${label(width - 56, base, 'More', t, 12)}`;
    return svg(width, base + 22, `Contribution calendar: ${num(d.contributions)} contributions in the last 12 months.`, body);
}

function languages(d, t) {
    const width = 1000, rowHeight = 34, y0 = 56, left = 130, barMax = width - left - 92;
    const top = Math.max(...d.languages.map((l) => l.count));
    const rows = d.languages.map((lang, i) => {
        const y = y0 + i * rowHeight, w = Math.max(8, (lang.count / top) * barMax);
        return `${label(22, y + 13, lang.name, t, 14, `fill-opacity="1"`).replace(t.muted, t.ink)}
            <path d="M${left} ${y + 2}h${w - 4}a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4h-${w - 4}z" fill="${t.accent}"/>
            <text x="${left + w + 10}" y="${y + 13}" fill="${t.muted}" font-family="${SANS}" font-size="13">${lang.count}</text>`;
    }).join('');
    const height = y0 + d.languages.length * rowHeight + 42;
    const body = `${panel(width, height, t)}
        <text x="22" y="32" fill="${t.ink}" font-family="${SANS}" font-weight="600" font-size="15">Main language by repository</text>
        ${rows}${label(22, height - 18, 'Number of public repositories, by the main language in each. Forks and markup such as HTML and CSS are excluded.', t, 12)}`;
    return svg(width, height, `Main language by repository: ${d.languages.map((l) => `${l.name} ${l.count}`).join(', ')}.`, body);
}

function projectCard(project, stars, t) {
    const width = 490, height = 196;
    const lines = wrap(project.text, 54).slice(0, 3);
    let x = 22;
    const tags = project.tags.map((tag) => {
        const w = 20 + tag.length * 7.2;
        const pill = `<g transform="translate(${x} 150)"><rect width="${w}" height="26" rx="13" fill="none" stroke="${t.line}"/><text x="${w / 2}" y="17.5" text-anchor="middle" fill="${t.muted}" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="12">${esc(tag)}</text></g>`;
        x += w + 7;
        return pill;
    }).join('');
    const star = stars > 0
        ? `<path transform="translate(${width - 58} 23) scale(.75)" fill="${t.muted}" d="M12 2l2.950 6.5 7.050.8-5.250 4.750 1.450 7L12 17.5 5.8 21.050l1.450-7L2 9.300l7.050-.8z"/><text x="${width - 34}" y="37" fill="${t.muted}" font-family="${SANS}" font-size="14">${stars}</text>`
        : '';
    const body = `${panel(width, height, t)}
        <rect x="22" y="24" width="4" height="20" rx="2" fill="${t.accent}"/>
        <text x="36" y="41" fill="${t.ink}" font-family="D,${SANS}" font-weight="700" font-size="22">${esc(project.title)}</text>${star}
        ${lines.map((line, i) => `<text x="22" y="${77 + i * 21}" fill="${t.muted}" font-family="${SANS}" font-size="14.5">${esc(line)}</text>`).join('')}${tags}`;
    return svg(width, height, `${project.title}: ${project.text}`, body, DISPLAY_FONT);
}

/* ---------- output ---------- */

function readmeTable(d) {
    const rows = [
        ['Contributions, last 12 months', num(d.contributions)],
        ['Longest streak', `${d.longest} days`],
        ['Current streak', `${d.current} days`],
        ['Public repositories', num(d.repos)],
        ['Stars earned', num(d.stars)],
        ...d.languages.map((l) => [`Repositories in ${l.name}`, l.count]),
    ];
    return ['| Metric | Value |', '|---|--:|', ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join('\n');
}

const data = await loadData();
const files = [];
for (const [mode, t] of Object.entries(THEMES)) {
    files.push([`hero-${mode}.svg`, hero(t)], [`tech-${mode}.svg`, techStack(t)], [`stats-${mode}.svg`, stats(data, t)],
        [`activity-${mode}.svg`, activity(data, t)], [`languages-${mode}.svg`, languages(data, t)]);
    for (const project of PROJECTS) {
        files.push([`project-${project.repo}-${mode}.svg`, projectCard(project, data.starsByRepo[project.repo] ?? 0, t)]);
    }
}
const mailIcon = '<path d="M2 5.5A2.5 2.5 0 0 1 4.5 3h15A2.5 2.5 0 0 1 22 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 18.5zm2.300-.300L12 11.2l7.700-6zM20 7.300l-8 6.2-8-6.2v11.2a.5.5 0 0 0 .5.5h15a.5.5 0 0 0 .5-.5z"/>';
const linkedInIcon = '<path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0z"/>';
files.push(button('linkedin', 'LinkedIn', linkedInIcon), button('instagram', 'Instagram', `<path d="${ICONS.Instagram.path}"/>`), button('email', 'Email me', mailIcon));

mkdirSync(OUT, { recursive: true });
for (const [name, content] of files) writeFileSync(join(OUT, name), content);

const readmePath = join(ROOT, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
writeFileSync(readmePath, readme.replace(/(<!-- stats:start -->)[\s\S]*?(<!-- stats:end -->)/, `$1\n\n${readmeTable(data)}\n\n$2`));

console.log(JSON.stringify({ files: files.length, contributions: data.contributions, longest: data.longest, current: data.current, repos: data.repos, stars: data.stars, languages: data.languages }));
