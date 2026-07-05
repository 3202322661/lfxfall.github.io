// ================= 全局配置 =================
let ROWS = 21; // 建议奇数
let COLS = 31; // 建议奇数
let grid = [];
let isMouseDown = false;
let isRunning = false;
let hasSearchedOnce = false;
let currentTool = 'wall';

// 地形定义
const TERRAINS = {
    empty:    { weight: 1,  class: '' },
    wall:     { weight: Infinity, class: 'wall' },
    forest:   { weight: 3,  class: 'forest' },
    swamp:    { weight: 5,  class: 'swamp' },
    water:    { weight: 10, class: 'water' },
    mountain: { weight: 20, class: 'mountain' },
    lava:     { weight: 50, class: 'lava' }
};

const NO_DIAGONAL_TERRAINS = ['mountain', 'lava', 'water', 'swamp'];

// DOM 元素
const container = document.getElementById('grid-container');
const statTime = document.getElementById('stat-time');
const statLength = document.getElementById('stat-length');
const statCost = document.getElementById('stat-cost');
const statVisited = document.getElementById('stat-visited');
const rowInput = document.getElementById('row-input');
const colInput = document.getElementById('col-input');
let startPos = { x: 1, y: 1 }; // 迷宫通常起点在(1,1)比较好看
let endPos = { x: COLS-2, y: ROWS-2 };

// 算法描述
const algoDescriptions = {
    astar: { title: "A* (混合移动)", desc: "平地可以走斜线，但在山地、水域等复杂地形中只能正向移动。智能权衡代价与方向。", tags: ["混合移动", "最真实"] },
    dijkstra: { title: "Dijkstra", desc: "保证找到全局最优解。同样遵循地形移动限制。", tags: ["全局最优", "严谨"] },
    bfs: { title: "BFS (广度优先)", desc: "⚠️ 不支持权重。但在复杂地形中也会被强制要求正向移动。", tags: ["无视权重", "仅步数"] },
    dfs: { title: "DFS (深度优先)", desc: "⚠️ 随机乱走。路径非常纠结。", tags: ["随机", "混乱"] },
    greedy: { title: "贪婪最佳优先", desc: "短视。极易在复杂地形边缘卡住。", tags: ["短视", "非最优"] }
};

// ================= Perlin Noise (保持不变) =================
const Noise = (function() {
    const perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for(let i=0; i<256; i++) p[i] = i;
    for(let i=256; i>0; i--) {
        const r = Math.floor(Math.random() * i);
        [p[i-1], p[r]] = [p[r], p[i-1]];
    }
    for(let i=0; i<512; i++) perm[i] = p[i & 255];
    function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    function lerp(t, a, b) { return a + t * (b - a); }
    function grad(hash, x, y, z) {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }
    return {
        perlin2: function(x, y) {
            const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
            x -= Math.floor(x); y -= Math.floor(y);
            const u = fade(x), v = fade(y);
            const A = perm[X] + Y, B = perm[X+1] + Y;
            return lerp(v, lerp(u, grad(perm[A], x, y, 0), grad(perm[B], x-1, y, 0)),
                           lerp(u, grad(perm[A+1], x, y-1, 0), grad(perm[B+1], x-1, y-1, 0)));
        },
        reseed: function() {
            for(let i=256; i>0; i--) {
                const r = Math.floor(Math.random() * i);
                [p[i-1], p[r]] = [p[r], p[i-1]];
            }
            for(let i=0; i<512; i++) perm[i] = p[i & 255];
        }
    };
})();

// ================= 初始化 =================

function init() {
    updateAlgoDescription();
    container.style.setProperty('--rows', ROWS);
    container.style.setProperty('--cols', COLS);
    calculateResponsiveSize();
    container.innerHTML = '';
    grid = new Array(COLS).fill(0).map(() => new Array(ROWS).fill(null));

    // 确保终点位置合法
    if(endPos.x >= COLS) endPos.x = COLS-2;
    if(endPos.y >= ROWS) endPos.y = ROWS-2;

    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.x = x; cell.dataset.y = y;

            if (x === startPos.x && y === startPos.y) cell.classList.add('start');
            if (x === endPos.x && y === endPos.y) cell.classList.add('end');

            cell.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if(!isRunning && e.ctrlKey) updateEndPoint(x, y);
            });
            cell.addEventListener('mousedown', (e) => {
                if(isRunning) return;
                if(e.ctrlKey && e.button === 0) { updateStartPoint(x, y); return; }
                if(e.button === 0) { isMouseDown = true; paintCell(cell); }
            });
            cell.addEventListener('mouseenter', () => {
                if(isMouseDown && !isRunning) paintCell(cell);
            });

            container.appendChild(cell);
            grid[x][y] = { element: cell, x, y, type: 'empty', weight: 1, f:0, g:0, h:0, parent: null, visited: false };
        }
    }
}

// ================= 交互逻辑 =================
function setTool(toolName) {
    currentTool = toolName;
    document.querySelectorAll('.brush-btn').forEach(btn => {
        btn.classList.remove('active');
        if(btn.dataset.tool === toolName) btn.classList.add('active');
    });
}

function paintCell(cell) {
    const x = parseInt(cell.dataset.x);
    const y = parseInt(cell.dataset.y);
    if((x===startPos.x && y===startPos.y) || (x===endPos.x && y===endPos.y)) return;
    
    const node = grid[x][y];
    if(node.type === currentTool) return;

    if(node.type !== 'empty') node.element.classList.remove(TERRAINS[node.type].class);
    
    node.type = currentTool;
    node.weight = TERRAINS[currentTool].weight;
    
    if(currentTool !== 'empty') {
        node.element.classList.add(TERRAINS[currentTool].class);
        if(['wall','mountain','forest'].includes(currentTool)) {
            node.element.classList.remove(TERRAINS[currentTool].class);
            void node.element.offsetWidth; 
            node.element.classList.add(TERRAINS[currentTool].class);
        }
    } else {
        node.element.classList.add('removing');
        setTimeout(() => node.element.classList.remove('removing'), 300);
    }
    triggerInstantSearch();
}

function updateStartPoint(x, y) {
    if (x === endPos.x && y === endPos.y) return;
    grid[startPos.x][startPos.y].element.classList.remove('start');
    startPos = { x, y };
    grid[x][y].element.classList.add('start');
    triggerInstantSearch();
}

function updateEndPoint(x, y) {
    if (x === startPos.x && y === startPos.y) return;
    grid[endPos.x][endPos.y].element.classList.remove('end');
    endPos = { x, y };
    grid[x][y].element.classList.add('end');
    triggerInstantSearch();
}

// ================= 地图生成器总控 =================

// 清理地图辅助函数
async function clearMapWithAnimation() {
    const activeCells = [];
    for(let x=0; x<COLS; x++) for(let y=0; y<ROWS; y++) {
        if(grid[x][y].type !== 'empty') {
            grid[x][y].element.classList.add('removing');
            activeCells.push(grid[x][y]);
        }
    }
    if(activeCells.length > 0) await new Promise(r => setTimeout(r, 300));
    for(let x=0; x<COLS; x++) for(let y=0; y<ROWS; y++) {
        const n = grid[x][y];
        n.element.className = 'cell'; 
        if(x===startPos.x && y===startPos.y) n.element.classList.add('start');
        if(x===endPos.x && y===endPos.y) n.element.classList.add('end');
        n.type = 'empty'; n.weight = 1;
    }
}

// 处理生成的入口
async function generateMapHandler() {
    if(isRunning) return;
    isRunning = true; hasSearchedOnce = false;
    resetStats(); clearPathVisuals();
    
    // 1. 先清空
    await clearMapWithAnimation();

    // 2. 根据选择调用不同算法
    const type = document.getElementById('maze-select').value;
    
    if(type === 'perlin') await generatePerlinTerrain();
    else if(type === 'random') await generateRandomWalls();
    else if(type === 'recursive') await generateRecursiveDivision(2, ROWS-3, 2, COLS-3); // 留出边框
    else if(type === 'backtracker') await generateDFSBacktracker();

    isRunning = false;
}

// 1. 柏林噪声 (保持不变)
async function generatePerlinTerrain() {
    Noise.reseed();
    const scale = 0.15; 
    for (let i = 0; i < COLS + ROWS; i++) {
        let hasChange = false;
        for (let x = 0; x < COLS; x++) {
            let y = i - x;
            if (y >= 0 && y < ROWS) {
                if((x===startPos.x && y===startPos.y) || (x===endPos.x && y===endPos.y)) continue;
                const value = Noise.perlin2(x * scale, y * scale);
                const n = grid[x][y];
                if (value < -0.3) n.type = 'water';
                else if (value < -0.1) n.type = 'swamp';
                else if (value < 0.25) n.type = 'empty';
                else if (value < 0.55) n.type = 'forest';
                else if (value < 0.75) n.type = 'mountain';
                else n.type = 'lava';

                if (n.type !== 'empty') {
                    n.weight = TERRAINS[n.type].weight;
                    n.element.classList.add(TERRAINS[n.type].class);
                    hasChange = true;
                }
            }
        }
        if(hasChange) await new Promise(r => setTimeout(r, 20)); 
    }
}

// 2. 随机墙壁 (保持不变)
async function generateRandomWalls() {
    const potentialWalls = [];
    for(let x=0; x<COLS; x++) for(let y=0; y<ROWS; y++) {
        if((x!==startPos.x || y!==startPos.y) && (x!==endPos.x || y!==endPos.y) && Math.random() < 0.3) {
            potentialWalls.push({x, y});
        }
    }
    potentialWalls.sort(() => Math.random() - 0.5);
    const batchSize = 10;
    for (let i = 0; i < potentialWalls.length; i += batchSize) {
        const batch = potentialWalls.slice(i, i + batchSize);
        batch.forEach(pos => {
            const n = grid[pos.x][pos.y];
            n.type = 'wall'; n.weight = Infinity; n.element.classList.add('wall');
            n.element.style.animation = 'none'; void n.element.offsetHeight; n.element.style.animation = null; 
        });
        await new Promise(r => setTimeout(r, 10));
    }
}

// 3. 递归分割 (分形迷宫 - Recursive Division)
async function generateRecursiveDivision(r1, r2, c1, c2) {
    // 只有当区域足够大时才分割
    if (r2 < r1 || c2 < c1) return;

    // 绘制外围围墙（第一次调用时）
    if(r1 === 2 && r2 === ROWS-3 && c1 === 2 && c2 === COLS-3) {
         for(let x=0; x<COLS; x++) {
             addWall(x, 0); addWall(x, ROWS-1);
         }
         for(let y=0; y<ROWS; y++) {
             addWall(0, y); addWall(COLS-1, y);
         }
         await new Promise(r => setTimeout(r, 50));
    }

    let horizontal = (r2 - r1) > (c2 - c1);
    
    // 确保墙壁在偶数坐标上，这样路径（奇数坐标）可以联通
    if (horizontal) {
        let wallY = Math.floor((Math.random() * (r2 - r1 + 1) + r1) / 2) * 2;
        // 确保不越界
        if(wallY < r1 || wallY > r2) return;
        
        let holeX = Math.floor((Math.random() * (c2 - c1 + 1) + c1) / 2) * 2 + 1;

        for (let i = c1 - 1; i <= c2 + 1; i++) {
            if (i !== holeX && i >= 0 && i < COLS) {
                addWall(i, wallY);
            }
        }
        await new Promise(r => setTimeout(r, 20));
        await generateRecursiveDivision(r1, wallY - 2, c1, c2);
        await generateRecursiveDivision(wallY + 2, r2, c1, c2);
    } else {
        let wallX = Math.floor((Math.random() * (c2 - c1 + 1) + c1) / 2) * 2;
        if(wallX < c1 || wallX > c2) return;

        let holeY = Math.floor((Math.random() * (r2 - r1 + 1) + r1) / 2) * 2 + 1;

        for (let i = r1 - 1; i <= r2 + 1; i++) {
            if (i !== holeY && i >= 0 && i < ROWS) {
                addWall(wallX, i);
            }
        }
        await new Promise(r => setTimeout(r, 20));
        await generateRecursiveDivision(r1, r2, c1, wallX - 2);
        await generateRecursiveDivision(r1, r2, wallX + 2, c2);
    }
}

// 4. DFS 回溯迷宫 (完美迷宫)
async function generateDFSBacktracker() {
    // 1. 先把整个地图填满墙壁
    for(let x=0; x<COLS; x++) for(let y=0; y<ROWS; y++) {
        addWall(x, y);
    }
    await new Promise(r => setTimeout(r, 500)); // 等待填满

    // 2. 从 (1,1) 开始挖掘
    // 确保起点是奇数坐标
    let startX = 1; let startY = 1;
    removeWall(startX, startY);

    let stack = [{x: startX, y: startY}];
    
    while(stack.length > 0) {
        let curr = stack[stack.length - 1]; // Peek
        
        // 寻找距离为2的未访问邻居 (隔着一堵墙)
        // 上下左右
        let neighbors = [];
        const dirs = [[0,-2], [0,2], [-2,0], [2,0]];
        
        dirs.forEach(d => {
            let nx = curr.x + d[0];
            let ny = curr.y + d[1];
            if(nx > 0 && nx < COLS-1 && ny > 0 && ny < ROWS-1) {
                // 如果目标点是墙，说明没被访问过（因为访问过会被挖空）
                if(grid[nx][ny].type === 'wall') {
                    neighbors.push({x: nx, y: ny, dx: d[0]/2, dy: d[1]/2});
                }
            }
        });

        if(neighbors.length > 0) {
            // 随机选一个邻居
            let chosen = neighbors[Math.floor(Math.random() * neighbors.length)];
            
            // 打通中间的墙
            removeWall(curr.x + chosen.dx, curr.y + chosen.dy);
            // 打通目标点
            removeWall(chosen.x, chosen.y);
            
            stack.push({x: chosen.x, y: chosen.y});
            
            // 动画延迟
            await new Promise(r => setTimeout(r, 10));
        } else {
            stack.pop();
        }
    }
    
    // 确保终点可达 (终点设为路)
    removeWall(endPos.x, endPos.y);
    removeWall(endPos.x-1, endPos.y); // 确保连通
}

// 辅助函数：添加/移除墙壁
function addWall(x, y) {
    if(x<0 || x>=COLS || y<0 || y>=ROWS) return;
    if((x===startPos.x && y===startPos.y) || (x===endPos.x && y===endPos.y)) return;
    const n = grid[x][y];
    if(n.type !== 'wall') {
        n.type = 'wall'; n.weight = Infinity; n.element.classList.add('wall');
    }
}
function removeWall(x, y) {
    if(x<0 || x>=COLS || y<0 || y>=ROWS) return;
    const n = grid[x][y];
    if(n.type === 'wall') {
        n.type = 'empty'; n.weight = 1; n.element.classList.remove('wall');
    }
}

// ================= 寻路逻辑 (保持不变) =================

function triggerInstantSearch() {
    if (!isRunning && hasSearchedOnce) instantSearch();
    else if (!isRunning) { clearPathVisuals(); resetGridData(); }
}

function instantSearch() {
    clearPathVisuals(); resetGridData();
    const res = executeAlgo();
    renderResult(res, true);
}

async function startSearch() {
    if(isRunning) return;
    hasSearchedOnce = true; isRunning = true;
    clearPathVisuals(); resetStats(); resetGridData();

    const res = executeAlgo();
    await animate(res.visited, res.pathFound ? grid[endPos.x][endPos.y] : null);
    renderResult(res, false);
    
    isRunning = false;
    if(!res.pathFound) alert("无法到达终点！");
}

function executeAlgo() {
    const algo = document.getElementById('algo-select').value;
    const start = grid[startPos.x][startPos.y];
    const end = grid[endPos.x][endPos.y];
    const t0 = performance.now();
    let res;
    switch(algo) {
        case 'astar': res = runAStar(start, end); break;
        case 'dijkstra': res = runAStar(start, end, true); break;
        case 'bfs': res = runBFS(start, end); break;
        case 'dfs': res = runDFS(start, end); break;
        case 'greedy': res = runGreedy(start, end); break;
    }
    res.time = (performance.now() - t0).toFixed(2);
    return res;
}

function renderResult(res, instant) {
    if(instant) {
        res.visited.forEach(n => { if(n!==grid[startPos.x][startPos.y] && n!==grid[endPos.x][endPos.y]) n.element.classList.add('visited'); });
    }
    let len = 0;
    if(res.pathFound) {
        let curr = grid[endPos.x][endPos.y];
        while(curr) {
            if(instant && curr!==grid[startPos.x][startPos.y] && curr!==grid[endPos.x][endPos.y]) {
                curr.element.classList.remove('visited'); curr.element.classList.add('path');
            }
            if(curr.parent) len++;
            curr = curr.parent;
        }
    }
    statTime.textContent = res.time; statVisited.textContent = res.visited.length;
    statLength.textContent = len; 
    statCost.textContent = res.totalCost.toFixed(1);
}

// ================= 核心算法 (支持8方向+混合移动) =================

function isMoveAllowed(curr, neighbor) {
    if (neighbor.weight === Infinity) return false;
    const isDiagonal = (curr.x !== neighbor.x && curr.y !== neighbor.y);
    // 斜向移动限制：只要有一方是复杂地形，就必须走直线
    if (isDiagonal) {
        if (NO_DIAGONAL_TERRAINS.includes(curr.type) || NO_DIAGONAL_TERRAINS.includes(neighbor.type)) {
            return false;
        }
    }
    return true;
}

function runAStar(start, end, isDijkstra = false) {
    let open = [start], visited = [];
    start.g = 0; 
    start.f = isDijkstra ? 0 : dist(start, end); 

    while(open.length) {
        open.sort((a,b) => a.f - b.f);
        let curr = open.shift();
        
        if(curr.visited) continue;
        curr.visited = true;
        visited.push(curr);
        
        if(curr === end) return { visited, pathFound: true, totalCost: curr.g };

        getNeighbors(curr).forEach(n => {
            if(!n.visited && isMoveAllowed(curr, n)) {
                let isDiagonal = (curr.x !== n.x && curr.y !== n.y);
                let moveCost = isDiagonal ? 1.414 : 1;
                let newG = curr.g + (moveCost * n.weight);
                
                if(n.g === 0 && n !== start) n.g = Infinity;
                
                if(newG < n.g || n.g === Infinity) {
                    n.g = newG;
                    n.h = isDijkstra ? 0 : dist(n, end);
                    n.f = n.g + n.h;
                    n.parent = curr;
                    if(!open.includes(n)) open.push(n);
                }
            }
        });
    }
    return { visited, pathFound: false, totalCost: 0 };
}

function runGreedy(start, end) {
    let open = [start], visited = [];
    start.g = 0; 
    while(open.length) {
        open.sort((a,b) => dist(a,end) - dist(b,end));
        let curr = open.shift();
        if(curr.visited) continue;
        curr.visited = true; visited.push(curr);
        if(curr === end) return { visited, pathFound: true, totalCost: curr.g };
        getNeighbors(curr).forEach(n => {
            if(!n.visited && isMoveAllowed(curr, n) && !open.includes(n)) {
                n.parent = curr;
                let isDiagonal = (curr.x !== n.x && curr.y !== n.y);
                n.g = curr.g + (isDiagonal ? 1.414 : 1) * n.weight; 
                open.push(n);
            }
        });
    }
    return { visited, pathFound: false, totalCost: 0 };
}

function runBFS(start, end) {
    let q = [start], visited = []; 
    start.visited = true; start.g = 0;
    while(q.length) {
        let curr = q.shift(); visited.push(curr);
        if(curr === end) return { visited, pathFound: true, totalCost: curr.g }; 
        getNeighbors(curr).forEach(n => {
            if(!n.visited && isMoveAllowed(curr, n)) {
                n.visited = true; n.parent = curr; 
                let isDiagonal = (curr.x !== n.x && curr.y !== n.y);
                n.g = curr.g + (isDiagonal ? 1.414 : 1) * n.weight;
                q.push(n); 
            }
        });
    }
    return { visited, pathFound: false, totalCost: 0 };
}

function runDFS(start, end) {
    let s = [start], visited = [];
    start.g = 0;
    while(s.length) {
        let curr = s.pop();
        if(curr.visited) continue;
        curr.visited = true; visited.push(curr);
        if(curr === end) return { visited, pathFound: true, totalCost: curr.g };
        getNeighbors(curr).sort(()=>Math.random()-0.5).forEach(n => {
            if(!n.visited && isMoveAllowed(curr, n)) { 
                n.parent = curr; 
                let isDiagonal = (curr.x !== n.x && curr.y !== n.y);
                n.g = curr.g + (isDiagonal ? 1.414 : 1) * n.weight;
                s.push(n); 
            }
        });
    }
    return { visited, pathFound: false, totalCost: 0 };
}

// 工具函数
function getNeighbors(node) {
    let res = [];
    const dirs = [[0,-1], [1,0], [0,1], [-1,0], [1,-1], [1,1], [-1,1], [-1,-1]];
    dirs.forEach(d => {
        let nx = node.x + d[0], ny = node.y + d[1];
        if(nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) res.push(grid[nx][ny]);
    });
    return res;
}
function dist(a, b) { return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2)); }
async function animate(visited, end) {
    let delay = visited.length > 500 ? 5 : 15;
    const start = grid[startPos.x][startPos.y];
    for(let i=0; i<visited.length; i++) {
        if(visited[i]!==start && visited[i]!==end) visited[i].element.classList.add('visited');
        if(i%3===0) await new Promise(r=>setTimeout(r, delay));
    }
    if(end) {
        let p=[], c=end; while(c){ p.push(c); c=c.parent; }
        for(let i=p.length-1; i>=0; i--) {
            if(p[i]!==start && p[i]!==end) { p[i].element.classList.remove('visited'); p[i].element.classList.add('path'); }
            await new Promise(r=>setTimeout(r, 20));
        }
    }
}
function clearPathVisuals() { document.querySelectorAll('.cell').forEach(el => el.classList.remove('visited', 'path')); }
function resetGridData() { for(let x=0; x<COLS; x++) for(let y=0; y<ROWS; y++) { let n=grid[x][y]; n.f=0; n.g=0; n.h=0; n.visited=false; n.parent=null; } }
function resetStats() { statTime.textContent="0.00"; statLength.textContent="0"; statCost.textContent="0"; statVisited.textContent="0"; }
function updateAlgoDescription() { 
    const info = algoDescriptions[document.getElementById('algo-select').value];
    document.getElementById('algo-title').textContent = info.title;
    document.getElementById('algo-desc').innerHTML = info.desc;
    document.getElementById('algo-tags').innerHTML = info.tags.map(t=>`<span class="tag ${t.includes('不')?'':'highlight'}">${t}</span>`).join('');
}
function calculateResponsiveSize() {
    const sidebarW = window.innerWidth>900 ? 340 : 0;
    const headerH = window.innerWidth>900 ? 120 : 320;
    const size = Math.max(15, Math.min(Math.floor((window.innerWidth-sidebarW-60)/COLS), Math.floor((window.innerHeight-headerH)/ROWS), 40));
    container.style.setProperty('--cell-size', size+'px');
}
window.addEventListener('resize', ()=> { clearTimeout(window.t); window.t=setTimeout(calculateResponsiveSize,100); });
document.addEventListener('mouseup', ()=>isMouseDown=false);
function applySize() {
    if(isRunning) return;
    ROWS = Math.max(5, Math.min(80, parseInt(rowInput.value)));
    COLS = Math.max(5, Math.min(80, parseInt(colInput.value)));
    rowInput.value=ROWS; colInput.value=COLS;
    startPos={x:1, y:1}; endPos={x:COLS-2, y:ROWS-2}; // 适应迷宫生成，起点设为(1,1)
    hasSearchedOnce=false; init();
}
async function resetAllWithAnimation() {
    if(isRunning) return; isRunning=true; hasSearchedOnce=false;
    resetStats(); clearPathVisuals();
    const cells = Array.from(document.querySelectorAll('.cell:not(.empty)'));
    cells.forEach(c => c.classList.add('removing'));
    await new Promise(r=>setTimeout(r, 300));
    init(); isRunning=false;
}

init();