// Text to Emoji Module – Custom style only, Font Awesome icons
// Auto‑uppercase + skip unsupported chars
class TextToEmojiModule {
    constructor() {
        this.storageKey = 'emoji-art-data';
        this.customFill = '😀';
        this.customEmpty = '⠀⠀';
        this.emojiPatterns = this.getEmojiPatterns();
        this.init();
    }

    init() {
        console.log('Text to Emoji Module initialized');
    }

    render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error('Emoji art container not found:', containerId);
            return;
        }
        container.innerHTML = this.getEmojiArtHTML();
        this.attachEventListeners();
    }

    getEmojiArtHTML() {
        return `
            <div class="text-to-emoji-module">
                <!-- Header -->
                <div class="module-card">
                    <div class="module-icon" style="color: var(--primary);">
                        <i class="fas fa-face-smile"></i>
                    </div>
                    <div class="module-info">
                        <div class="module-title">Emoji Art Generator</div>
                        <div class="module-description">Convert text to emoji‑based pixel art (custom emojis)</div>
                    </div>
                </div>

                <!-- Main Content -->
                <div class="emoji-main">
                    <!-- Input Card -->
                    <div class="section-card">
                        <div class="section-card-header">
                            <div class="section-card-title">
                                <i class="fas fa-pen"></i>
                                <span>Input Settings</span>
                            </div>
                            <span class="section-card-badge">
                                <i class="fas fa-pen"></i>
                                Title &amp; Text
                            </span>
                        </div>
                        <div class="section-card-content">           
                            <form class="emoji-form" id="emojiGeneratorForm">
                                <div class="form-group">
                                    <label class="form-label" for="textInput">Base Text: <span id="charCount">5</span>/20</label>
                                    <input type="text" id="textInput" class="form-input"
                                        placeholder="Enter text (A-Z, 0-9, symbols)…" maxlength="20" value="HELLO">
                                    <div class="form-help">Lowercase → uppercase; unsupported characters are skipped</div>
                                </div>

                                <!-- Custom Emoji Inputs (always visible) -->
                                <div class="form-row">
                                    <div class="form-group">
                                        <label class="form-label" for="customFillEmoji">Fill Emoji</label>
                                        <input type="text" id="customFillEmoji" class="form-input"
                                            placeholder="😀" maxlength="2" value="${this.customFill}">
                                        <div class="form-help">Emoji for filled pixels</div>
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label" for="customEmptyEmoji">Empty Emoji</label>
                                        <input type="text" id="customEmptyEmoji" class="form-input"
                                            placeholder="⠀⠀" maxlength="2" value="${this.customEmpty}">
                                        <div class="form-help">Emoji for empty pixels</div>
                                    </div>
                                </div>
                                <div class="form-actions">
                                    <button type="submit" class="btn btn-primary" id="generateEmojiBtn">
                                        <i class="fas fa-gear"></i> Generate Art
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>

                    <!-- Output Card -->
                    <div class="section-card">
                        <div class="section-card-header">
                            <div class="section-card-title">
                                <i class="fas fa-images"></i>
                                <span> Generated Output</span>
                            </div>
                            <span class="section-card-badge">
                                <span id="emojiOutputStats">0 lines, 0 characters</span>
                            </span>
                        </div>
                        <div style="padding:8px;">
                            <button type="button" class="btn btn-secondary" id="copyEmojiBtn">
                                <i class="fas fa-copy"></i> Copy
                            </button>
                            <button type="button" class="btn btn-warning" style="margin-left:8px;" id="clearEmojiBtn">
                                <i class="fas fa-broom"></i> Clear
                            </button>
                        </div>
                        <div class="section-card-content" id="emojiOutputContainer">
                            <div class="output-placeholder">
                                <i class="fas fa-face-smile" style="font-size: 2.5rem; opacity: 0.5;"></i>
                                <p>Your emoji art will appear here</p>
                                <small>Choose your emojis and click Generate</small>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // ===== attachEventListeners with auto‑generate on input =====
    attachEventListeners() {
        const generatorForm = document.getElementById('emojiGeneratorForm');
        if (generatorForm) {
            generatorForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.generateEmojiArt();
            });
        }

        document.getElementById('generateEmojiBtn')?.addEventListener('click', () => this.generateEmojiArt());
        document.getElementById('copyEmojiBtn')?.addEventListener('click', () => this.copyToClipboard());
        document.getElementById('clearEmojiBtn')?.addEventListener('click', () => this.clearOutput());

        // --- AUTO‑GENERATE ON TYPING (NEW) ---
        const textInput = document.getElementById('textInput');
        if (textInput) {
            textInput.addEventListener('input', (e) => {
                // Update character count
                let charCount = e.target.value.length;
                if (charCount > 20) {
                    e.target.value = e.target.value.slice(0, 20);
                    charCount = 20;
                }
                document.getElementById('charCount').textContent = charCount;

                // Auto‑generate on every keystroke
                this.generateEmojiArt();
            });

            // Keep Enter key as a shortcut (optional)
            textInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.generateEmojiArt();
                }
            });

            // Double‑click to reset to "HELLO" (keep original behaviour)
            textInput.addEventListener('dblclick', () => {
                if (!document.getElementById('textInput').value) {
                    document.getElementById('textInput').value = 'HELLO';
                    document.getElementById('charCount').textContent = 5;
                    this.generateEmojiArt();
                }
            });
        }

        // Custom emoji inputs – re‑generate when they change
        document.getElementById('customFillEmoji')?.addEventListener('input', () => {
            this.customFill = document.getElementById('customFillEmoji').value || '😀';
            this.generateEmojiArt();
        });
        document.getElementById('customEmptyEmoji')?.addEventListener('input', () => {
            this.customEmpty = document.getElementById('customEmptyEmoji').value || '⠀⠀';
            this.generateEmojiArt();
        });
    }

    getCurrentStyle() {
        return {
            fill: this.customFill || '😀',
            empty: this.customEmpty || '⠀⠀'
        };
    }

    // getEmojiPatterns() – returns the full dictionary (unchanged)
    getEmojiPatterns() {
        return {
            // Numbers
            '0': [
                "100001",
                "000000",
                "001100",
                "001100",
                "001100",
                "001100",
                "000000",
                "100001"
            ],
            '1': [
                "1100111",
                "000011",
                "110011",
                "110011",
                "110011",
                "110011",
                "100001",
                "100001"
            ],
            '2': [
                "100001",
                "001100",
                "001100",
                "111000",
                "110011",
                "100111",
                "000000",
                "000000"
            ],
            '3': [
                "100000",
                "000000",
                "111100",
                "100001",
                "100001",
                "111100",
                "000000",
                "100000"
            ],
            '4': [
                "001100",
                "001100",
                "001100",
                "000000",
                "000000",
                "111100",
                "111100",
                "111100"
            ],
            '5': [
                "000000",
                "000000",
                "001111",
                "000000",
                "000000",
                "111100",
                "111100",
                "000001"
            ],
            '6': [
                "100001",
                "001100",
                "001111",
                "001111",
                "000001",
                "001100",
                "001100",
                "100001"
            ],
            '7': [
                "000000",
                "000000",
                "111100",
                "111001",
                "110011",
                "100111",
                "001111",
                "001111"
            ],
            '8': [
                "100001",
                "001100",
                "001100",
                "100001",
                "100001",
                "001100",
                "001100",
                "100001"
            ],
            '9': [
                "100001",
                "000000",
                "001100",
                "001100",
                "100000",
                "111100",
                "011100",
                "100001"
            ],
            // Uppercase Letters
            'A': [
                "100001",
                "000000",
                "001100",
                "001100",
                "000000",
                "000000",
                "001100",
                "001100"
            ],
            'B': [
                "000001",
                "000000",
                "001100",
                "000001",
                "000001",
                "001100",
                "000000",
                "000001"
            ],
            'C': [
                "100001",
                "000000",
                "001100",
                "001111",
                "001111",
                "001100",
                "000000",
                "100001"
            ],
            'D': [
                "000001",
                "000000",
                "001100",
                "001100",
                "001100",
                "001100",
                "000000",
                "000001"
            ],
            'E': [
                "000000",
                "000000",
                "001111",
                "000001",
                "000001",
                "001111",
                "000000",
                "000000"
            ],
            'F': [
                "000000",
                "000000",
                "001111",
                "000001",
                "000001",
                "001111",
                "001111",
                "001111"
            ],
            'G': [
                "100001",
                "000000",
                "001100",
                "001111",
                "001000",
                "001000",
                "000010",
                "100010"
            ],
            'H': [
                "001100",
                "001100",
                "001100",
                "000000",
                "000000",
                "001100",
                "001100",
                "001100"
            ],
            'I': [
                "100001",
                "100001",
                "110011",
                "110011",
                "110011",
                "110011",
                "100001",
                "100001"
            ],
            'J': [
                "110000",
                "110000",
                "111001",
                "111001",
                "111001",
                "001001",
                "000001",
                "100011"
            ],
            'K': [
                "001100",
                "001100",
                "001001",
                "000011",
                "000011",
                "001001",
                "001100",
                "001100"
            ],
            'L': [
                "001111",
                "001111",
                "001111",
                "001111",
                "001111",
                "001111",
                "000001",
                "000001"
            ],
            'M': [
                "011110",
                "001100",
                "000000",
                "000000",
                "001100",
                "001100",
                "001100",
                "001100"
            ],
            'N': [
                "011100",
                "001100",
                "000100",
                "000000",
                "000000",
                "001000",
                "001100",
                "001110"
            ],
            'O': [
                "100001",
                "000000",
                "001100",
                "001100",
                "001100",
                "001100",
                "000000",
                "100001"
            ],
            'P': [
                "000001",
                "000000",
                "001100",
                "001100",
                "000001",
                "001111",
                "001111",
                "001111"
            ],
            'Q': [
                "100001",
                "000000",
                "001100",
                "001100",
                "001100",
                "001001",
                "000000",
                "100010"
            ],
            'R': [
                "000001",
                "000000",
                "001100",
                "001100",
                "000001",
                "001001",
                "001100",
                "001100"
            ],
            'S': [
                "100000",
                "000000",
                "001111",
                "000001",
                "100000",
                "111000",
                "000000",
                "000001"
            ],
            'T': [
                "000000",
                "000000",
                "110011",
                "110011",
                "110011",
                "110011",
                "110011",
                "110011"
            ],
            'U': [
                "001100",
                "001100",
                "001100",
                "001100",
                "001100",
                "001100",
                "000000",
                "100001"
            ],
            'V': [
                "001100",
                "001100",
                "001100",
                "001100",
                "001100",
                "001100",
                "100001",
                "110011"
            ],
            'W': [
                "001100",
                "001100",
                "001100",
                "001100",
                "000000",
                "000000",
                "001100",
                "011110"
            ],
            'X': [
                "001100",
                "001100",
                "100001",
                "110011",
                "110011",
                "100001",
                "001100",
                "001100",
            ],
            'Y': [
                "001100",
                "001100",
                "000000",
                "100001",
                "110011",
                "110011",
                "110011",
                "110011"
            ],
            'Z': [
                "000000",
                "000000",
                "111000",
                "110001",
                "100011",
                "000111",
                "000000",
                "000000"
            ],
            // Special Characters
            '!': [
                "110011",
                "110011",
                "110011",
                "110011",
                "110011",
                "111111",
                "110011",
                "110011",
            ],
            '?': [
                "100001",
                "001110",
                "111100",
                "111001",
                "110011",
                "110011",
                "111111",
                "110011"
            ],
            '.': [
                "111111",
                "111111",
                "111111",
                "111111",
                "111111",
                "100011",
                "100011",
                "111111"
            ],
            ',': [
                "111111",
                "111111",
                "111111",
                "111111",
                "111001",
                "110011",
                "100111",
                "111111"
            ],
            ':': [
                "111111",
                "110011",
                "110011",
                "111111",
                "111111",
                "110011",
                "110011",
                "111111"
            ],
            ';': [
                "111111",
                "111001",
                "111001",
                "111111",
                "111111",
                "111001",
                "110011",
                "100111"
            ],
            '@': [
                "100001",
                "011110",
                "010000",
                "010100",
                "010100",
                "010000",
                "011111",
                "100000"
            ],
            '#': [
                "101101",
                "000000",
                "000000",
                "101101",
                "101101",
                "000000",
                "000000",
                "101101"
            ],
            '$': [
                "110011",
                "000000",
                "010010",
                "000011",
                "110000",
                "010010",
                "000000",
                "110011"
            ],
            '%': [
                "111111",
                "001111",
                "001100",
                "111001",
                "110011",
                "100111",
                "001100",
                "111100",
                "111111"
            ],
            '&': [
                "100001",
                "001100",
                "001100",
                "100001",
                "101001",
                "001100",
                "001100",
                "000010",
            ],
            '*': [
                "111111",
                "001100",
                "001100",
                "100001",
                "100001",
                "001100",
                "111111",
                "111111"
            ],
            '+': [
                "111111",
                "110011",
                "110011",
                "000000",
                "000000",
                "110011",
                "110011",
                "111111"
            ],
            '-': [
                "111111",
                "111111",
                "000000",
                "000000",
                "111111",
                "111111",
                "111111",
                "111111"
            ],
            '=': [
                "111111",
                "000000",
                "000000",
                "111111",
                "000000",
                "000000",
                "111111",
                "111111"
            ],
            '/': [
                "111111",
                "111110",
                "111100",
                "111001",
                "110011",
                "100111",
                "001111",
                "011111"
            ],
            '|': [
                "111111",
                "110011",
                "110011",
                "110011",
                "110011",
                "110011",
                "110011",
                "111111",
            ],
            '(': [
                "111100",
                "110011",
                "100111",
                "001111",
                "001111",
                "100111",
                "110011",
                "111100",
            ],
            ')': [
                "001111",
                "110011",
                "111001",
                "111100",
                "111100",
                "111001",
                "110011",
                "001111"
            ],
            '[': [
                "000011",
                "000011",
                "001111",
                "001111",
                "001111",
                "001111",
                "000011",
                "000011"
            ],
            ']': [
                "110000",
                "110000",
                "111100",
                "111100",
                "111100",
                "111100",
                "110000",
                "110000"
            ],
            '>': [
                "111111",
                "100111",
                "110011",
                "111100",
                "111100",
                "110011",
                "100111",
                "111111"
            ],
            '<': [
                "111111",
                "111001",
                "110011",
                "001111",
                "001111",
                "110011",
                "111001",
                "111111"
            ]
        };
    }

    // ===== generateEmojiArt – clears output when input is empty =====
    generateEmojiArt() {
        const textInput = document.getElementById('textInput');
        const outputContainer = document.getElementById('emojiOutputContainer');
        const outputStats = document.getElementById('emojiOutputStats');

        if (!textInput || !outputContainer) return;

        let rawText = textInput.value;
        let text = rawText.toUpperCase();

        // Filter out unsupported characters
        text = text.split('').filter(char => this.emojiPatterns[char]).join('');

        // --- If nothing remains, show placeholder (not an error) ---
        if (!text) {
            // Restore placeholder
            outputContainer.innerHTML = `
                <div class="output-placeholder">
                    <i class="fas fa-face-smile" style="font-size: 2.5rem; opacity: 0.5;"></i>
                    <p>Your emoji art will appear here</p>
                    <small>Choose your emojis and click Generate</small>
                </div>
            `;
            if (outputStats) outputStats.textContent = '0 lines, 0 characters';
            return;
        }

        // Enforce 20‑character limit
        if (text.length > 20) {
            text = text.slice(0, 20);
        }

        // Update input field with cleaned text
        textInput.value = text;
        document.getElementById('charCount').textContent = text.length;

        const style = this.getCurrentStyle();
        const replacedPatterns = {};
        for (let key in this.emojiPatterns) {
            replacedPatterns[key] = this.emojiPatterns[key].map(line =>
                line.replace(/0/g, style.fill).replace(/1/g, style.empty)
            );
        }

        let emojiArt = '';
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const pattern = replacedPatterns[char];
            if (pattern) {
                emojiArt += pattern.join('\n');
                if (i < text.length - 1) emojiArt += '\n\n';
            }
        }

        outputContainer.innerHTML = `<pre class="generated-output emoji-art-text">${this.escapeHtml(emojiArt)}</pre>`;

        const lines = emojiArt.split('\n').length;
        const chars = emojiArt.replace(/\n/g, '').length;
        if (outputStats) {
            outputStats.textContent = `${lines} lines, ${chars} characters`;
        }

        // Optional: silent success (no toast on every keystroke – remove or keep)
        // this.showSuccess('Emoji art generated successfully!'); // ← comment out to avoid spam
    }

    // ---------- remaining methods (copy, clear, etc.) are unchanged ----------
    copyToClipboard() {
        const output = document.querySelector('#emojiOutputContainer pre');
        const copyBtn = document.getElementById('copyEmojiBtn');

        if (!output || output.textContent.includes('Your emoji art will appear here')) {
            this.showError('No output to copy. Generate some emoji art first!');
            return;
        }

        navigator.clipboard.writeText(output.textContent).then(() => {
            this.showSuccess('✓ Copied to clipboard!');
            if (copyBtn) {
                const originalHTML = copyBtn.innerHTML;
                copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
                copyBtn.style.background = 'var(--primary)';
                copyBtn.style.borderColor = 'var(--primary)';
                setTimeout(() => {
                    copyBtn.innerHTML = originalHTML;
                    copyBtn.style.background = '';
                    copyBtn.style.borderColor = '';
                }, 2000);
            }
        }).catch(() => {
            this.showError('Failed to copy. Please try again.');
        });
    }

    showSuccess(message) {
        const container = document.getElementById('emojiOutputContainer');
        if (!container) return;
        const existing = container.querySelector('.temp-message');
        if (existing) existing.remove();

        const msgDiv = document.createElement('div');
        msgDiv.className = 'temp-message success-message';
        msgDiv.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
        msgDiv.style.cssText = `
            position: absolute; bottom: 12px; right: 12px;
            background: rgba(16, 185, 129, 0.95); color: white;
            padding: 8px 16px; border-radius: 8px; font-size: 0.85rem;
            display: flex; align-items: center; gap: 8px; z-index: 100;
            animation: slideIn 0.3s ease;
        `;
        container.style.position = 'relative';
        container.appendChild(msgDiv);
        setTimeout(() => msgDiv.remove(), 2000);
    }

    showError(message) {
        const container = document.getElementById('emojiOutputContainer');
        if (!container) return;
        const existing = container.querySelector('.temp-message');
        if (existing) existing.remove();

        const msgDiv = document.createElement('div');
        msgDiv.className = 'temp-message error-message';
        msgDiv.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
        msgDiv.style.cssText = `
            position: absolute; bottom: 12px; right: 12px;
            background: rgba(239, 68, 68, 0.95); color: white;
            padding: 8px 16px; border-radius: 8px; font-size: 0.85rem;
            display: flex; align-items: center; gap: 8px; z-index: 100;
            animation: slideIn 0.3s ease;
        `;
        container.style.position = 'relative';
        container.appendChild(msgDiv);
        setTimeout(() => msgDiv.remove(), 3000);
    }

    clearOutput() {
        const container = document.getElementById('emojiOutputContainer');
        if (container) {
            container.innerHTML = `
                <div class="output-placeholder">
                    <i class="fas fa-face-smile" style="font-size: 2.5rem; opacity: 0.5;"></i>
                    <p>Your emoji art will appear here</p>
                    <small>Choose your emojis and click Generate</small>
                </div>
            `;
        }
        const stats = document.getElementById('emojiOutputStats');
        if (stats) stats.textContent = '0 lines, 0 characters';
        this.showSuccess('Output cleared');
    }

    escapeHtml(str) {
        return str.replace(/[&<>]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }
}

// Initialize globally
let emojiArtModule;
document.addEventListener('DOMContentLoaded', function() {
    emojiArtModule = new TextToEmojiModule();
    window.emojiArtModule = emojiArtModule;
});