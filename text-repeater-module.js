// Text Repeater Module – matching emoji module design & auto‑generate
class TextRepeaterModule {
    constructor() {
        this.currentPattern = null;
        this.selectedPattern = 'normal';
    }

    async initTextRepeater() {
        console.log('Text Repeater module initialized');
        return true;
    }

    async render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error('Text repeater container not found:', containerId);
            return;
        }

        console.log('Rendering text repeater module');
        await this.initTextRepeater();
        container.innerHTML = this.getHTML();
        this.setupEventListeners();
        this.initControls();
        this.updatePatternButtonsActive(this.selectedPattern);
        // Auto‑generate initial output
        this.generatePattern();
    }

    getHTML() {
        const patterns = [
            { id: 'normal', name: 'Normal', icon: 'fa-arrows-left-right' },
            { id: 'wave', name: 'Wave', icon: 'fa-wave-square' },
            { id: 'triangle', name: 'Triangle', icon: 'fa-chart-line' },
            { id: 'square', name: 'Square', icon: 'fa-square' },
            { id: 'staircase', name: 'Staircase', icon: 'fa-stairs' },
            { id: 'random', name: 'Random', icon: 'fa-shuffle' }
        ];

        const patternButtonsHtml = patterns.map(p => `
            <button type="button" class="pattern-btn ${this.selectedPattern === p.id ? 'active' : ''}" data-pattern="${p.id}">
                <i class="fas ${p.icon}"></i>
                <span class="pattern-btn-name">${p.name}</span>
            </button>
        `).join('');

        return `
            <div class="text-repeater-module">
                <!-- Header -->
                <div class="module-card">
                    <div class="module-icon" style="color: var(--primary);">
                        <i class="fas fa-repeat"></i>
                    </div>
                    <div class="module-info">
                        <div class="module-title">Text Repeater</div>
                        <div class="module-description">Create patterned text repetitions with dynamic spacing styles</div>
                    </div>
                </div>

                <!-- Main Content -->
                <div class="repeater-main">
                    <!-- Input Card -->
                    <div class="section-card">
                        <div class="section-card-header">
                            <div class="section-card-title">
                                <i class="fas fa-pen"></i>
                                <span>Input Settings</span>
                            </div>
                            <span class="section-card-badge">
                                <i class="fas fa-sliders-h"></i>
                                Repeat &amp; Pattern
                            </span>
                        </div>
                        <div class="section-card-content">
                            <form class="repeater-form" id="generatorForm">
                                <div class="form-group">
                                    <label class="form-label" for="inputText">Base Text</label>
                                    <input type="text" id="inputText" class="form-input" 
                                        placeholder="Enter text to repeat..." maxlength="60" value="Hello World!">
                                    <div class="form-help">Text that will be repeated with pattern spacing</div>
                                </div>
                                <div class="form-row">
                                    <div class="form-group">
                                        <label class="form-label" for="repeatCount">Repeat Count</label>
                                        <div class="number-input-group">
                                            <input type="number" id="repeatCount" class="form-input" 
                                                min="1" max="1000" value="50">
                                            <div class="number-controls">
                                                <button type="button" class="number-btn" id="incCount">
                                                    <i class="fas fa-chevron-up"></i>
                                                </button>
                                                <button type="button" class="number-btn" id="decCount">
                                                    <i class="fas fa-chevron-down"></i>
                                                </button>
                                            </div>
                                        </div>
                                        <div class="form-help">Number of repetitions (1‑1000)</div>
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label">Amplitude Control</label>
                                        <div class="slider-container">
                                            <div class="slider-track-custom">
                                                <div class="slider-fill-custom" id="sliderFill"></div>
                                                <input type="range" id="amplitudeSlider" class="slider-input" 
                                                    min="1" max="20" value="5">
                                            </div>
                                            <div class="slider-values">
                                                <span>Min (1)</span>
                                                <span>Amplitude: <span id="amplitudeValue">5</span></span>
                                                <span>Max (20)</span>
                                            </div>
                                        </div>
                                        <div class="form-help">Controls the intensity of spacing pattern</div>
                                    </div>
                                </div>

                                <!-- Pattern Selection Buttons -->
                                <div class="form-group">
                                    <label class="form-label">Pattern Style</label>
                                    <div class="pattern-buttons-grid" id="patternButtonsGrid">
                                        ${patternButtonsHtml}
                                    </div>
                                    <div class="form-help">Click any pattern to select — visual preview updates instantly</div>
                                </div>
                                <div class="pattern-preview-container">
                                    <label class="form-label">Pattern Preview</label>
                                    <div class="pattern-preview" id="patternPreview"></div>
                                </div>
                                <div class="form-actions">
                                    <button type="submit" class="btn btn-primary" id="generateBtn">
                                        <i class="fas fa-gear"></i> Generate Pattern
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>

                    <!-- Output Card -->
                    <div class="section-card">
                        <div class="section-card-header">
                            <div class="section-card-title">
                                <i class="fas fa-code"></i>
                                <span>Generated Output</span>
                            </div>
                            <span class="section-card-badge" id="outputStatsBadge">
                                <span id="outputStats">0 lines, 0 characters</span>
                            </span>
                        </div>
                        <div style="padding:8px;">
                            <button type="button" class="btn btn-secondary" id="copyOutputBtn">
                                <i class="fas fa-copy"></i> Copy
                            </button>
                            <button type="button" class="btn btn-warning" id="clearOutputBtn">
                                <i class="fas fa-broom"></i> Clear
                            </button>
                        </div>
                        <div class="section-card-content" id="outputContainer">
                            <div class="output-placeholder">
                                <i class="fas fa-code" style="font-size: 2.5rem; opacity: 0.5;"></i>
                                <p>Your generated text will appear here</p>
                                <small>Select a pattern and click Generate</small>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    initControls() {
        this.updateSliderFill();
        this.updatePatternPreview();
        this.updateCountDisplay();
    }

    setupEventListeners() {
        // Form submission (manual)
        const generatorForm = document.getElementById('generatorForm');
        if (generatorForm) {
            generatorForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.generatePattern();
            });
        }

        // Amplitude slider – update preview and auto‑generate
        const amplitudeSlider = document.getElementById('amplitudeSlider');
        if (amplitudeSlider) {
            amplitudeSlider.addEventListener('input', () => {
                const amplitudeValue = document.getElementById('amplitudeValue');
                if (amplitudeValue) amplitudeValue.textContent = amplitudeSlider.value;
                this.updateSliderFill();
                this.updatePatternPreview();
                this.generatePattern(); // auto‑generate on slider change
            });
        }

        // Repeat count – auto‑generate on change
        const repeatCount = document.getElementById('repeatCount');
        if (repeatCount) {
            repeatCount.addEventListener('input', () => {
                this.updateCountDisplay();
                this.generatePattern();
            });
        }

        // Number controls (increment/decrement)
        document.getElementById('incCount')?.addEventListener('click', () => {
            const input = document.getElementById('repeatCount');
            if (parseInt(input.value) < 1000) {
                input.value = parseInt(input.value) + 1;
                this.updateCountDisplay();
                this.generatePattern();
            }
        });
        document.getElementById('decCount')?.addEventListener('click', () => {
            const input = document.getElementById('repeatCount');
            if (parseInt(input.value) > 1) {
                input.value = parseInt(input.value) - 1;
                this.updateCountDisplay();
                this.generatePattern();
            }
        });

        // Pattern Buttons – auto‑generate on selection
        this.setupPatternButtons();

        // Manual buttons
        document.getElementById('generateBtn')?.addEventListener('click', () => this.generatePattern());
        document.getElementById('copyOutputBtn')?.addEventListener('click', () => this.copyToClipboard());
        document.getElementById('clearOutputBtn')?.addEventListener('click', () => this.clearOutput());

        // Input text – auto‑generate on typing
        const inputText = document.getElementById('inputText');
        if (inputText) {
            inputText.addEventListener('input', () => this.generatePattern());
            inputText.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.generatePattern();
            });
        }
    }

    setupPatternButtons() {
        const buttons = document.querySelectorAll('.pattern-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                const patternId = btn.getAttribute('data-pattern');
                if (patternId) {
                    this.selectedPattern = patternId;
                    this.updatePatternButtonsActive(patternId);
                    this.updatePatternPreview();
                    this.generatePattern(); // auto‑generate on pattern change
                }
            });
        });
    }

    updatePatternButtonsActive(activePatternId) {
        const buttons = document.querySelectorAll('.pattern-btn');
        buttons.forEach(btn => {
            const patternId = btn.getAttribute('data-pattern');
            if (patternId === activePatternId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    updateSliderFill() {
        const slider = document.getElementById('amplitudeSlider');
        const fill = document.getElementById('sliderFill');
        if (slider && fill) {
            const percent = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
            fill.style.width = `${percent}%`;
        }
    }

    updateCountDisplay() {
        const countInput = document.getElementById('repeatCount');
        if (countInput) {
            let val = parseInt(countInput.value);
            if (isNaN(val)) val = 1;
            if (val > 1000) val = 1000;
            if (val < 1) val = 1;
            countInput.value = val;
        }
    }

    updatePatternPreview() {
        const pattern = this.selectedPattern;
        const amplitude = parseInt(document.getElementById('amplitudeSlider')?.value || 5);
        const previewContainer = document.getElementById('patternPreview');
        
        if (!previewContainer) return;
        
        previewContainer.innerHTML = '';
        const barCount = 30;
        
        for (let i = 0; i < barCount; i++) {
            const bar = document.createElement('div');
            bar.className = 'preview-bar';
            
            let height = 0;
            switch(pattern) {
                case 'wave':
                    height = Math.abs(Math.floor(amplitude * Math.sin(i / 1.8))) / amplitude * 80;
                    break;
                case 'triangle':
                    height = Math.abs(amplitude - (i % (amplitude * 2))) / amplitude * 80;
                    break;
                case 'square':
                    height = i % 4 < 2 ? 80 : 20;
                    break;
                case 'staircase':
                    height = (i % amplitude) / amplitude * 80;
                    break;
                case 'random':
                    height = Math.random() * 80;
                    break;
                default:
                    height = 0;
            }
            
            bar.style.height = `${Math.max(4, height)}%`;
            bar.style.width = `${100 / barCount}%`;
            previewContainer.appendChild(bar);
        }
    }

    calculateSpacing(index, pattern, amplitude) {
        switch(pattern) {
            case 'wave': 
                return ' '.repeat(Math.abs(Math.floor(amplitude * Math.sin(index / 2))));
            case 'triangle': 
                return ' '.repeat(Math.abs(amplitude - (index % (amplitude * 2))));
            case 'square': 
                return ' '.repeat(index % 4 < 2 ? 0 : amplitude);
            case 'staircase': 
                return ' '.repeat(index % amplitude);
            case 'random': 
                return ' '.repeat(Math.floor(Math.random() * amplitude));
            default: 
                return '';
        }
    }

    generatePattern() {
        const text = document.getElementById('inputText')?.value.trim();
        let count = parseInt(document.getElementById('repeatCount')?.value) || 1;
        const pattern = this.selectedPattern;
        const amplitude = parseInt(document.getElementById('amplitudeSlider')?.value);
        
        if (!text) {
            // Show placeholder instead of error
            this.showPlaceholder();
            return;
        }
        
        if (count > 1000) count = 1000;
        if (count < 1) count = 1;
        
        let output = '';
        for (let i = 0; i < count; i++) {
            const spaces = this.calculateSpacing(i, pattern, amplitude);
            output += spaces + text + '\n';
        }
        
        const outputContainer = document.getElementById('outputContainer');
        if (outputContainer) {
            outputContainer.innerHTML = `<pre class="generated-output">${this.escapeHtml(output)}</pre>`;
        }
        
        const lines = output.split('\n').filter(l => l !== '').length;
        const chars = output.replace(/\n/g, '').length;
        const outputStats = document.getElementById('outputStats');
        if (outputStats) {
            outputStats.textContent = `${lines} lines, ${chars} characters`;
        }
        
        this.currentPattern = {
            text, count, pattern, amplitude, output,
            timestamp: new Date().toISOString()
        };
        
        // Optional: silent success (no toast on every keystroke)
        // this.showSuccess('Pattern generated successfully!');
    }

    showPlaceholder() {
        const outputContainer = document.getElementById('outputContainer');
        if (!outputContainer) return;
        outputContainer.innerHTML = `
            <div class="output-placeholder">
                <i class="fas fa-code" style="font-size: 2.5rem; opacity: 0.5;"></i>
                <p>Your generated text will appear here</p>
                <small>Enter some text and adjust settings</small>
            </div>
        `;
        const outputStats = document.getElementById('outputStats');
        if (outputStats) outputStats.textContent = '0 lines, 0 characters';
    }

    copyToClipboard() {
        const output = document.querySelector('#outputContainer pre');
        const copyBtn = document.getElementById('copyOutputBtn');
        
        if (!output || output.textContent.includes('Your generated text will appear here')) {
            this.showError('No output to copy. Generate a pattern first!');
            return;
        }
        
        navigator.clipboard.writeText(output.textContent).then(() => {
            this.showSuccess('✓ Copied to clipboard!');
            if (copyBtn) {
                const originalHTML = copyBtn.innerHTML;
                copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
                copyBtn.style.background = 'var(--primary)';
                copyBtn.style.borderColor = 'var(--primary)';
                copyBtn.style.color = 'white';
                setTimeout(() => {
                    copyBtn.innerHTML = originalHTML;
                    copyBtn.style.background = '';
                    copyBtn.style.borderColor = '';
                    copyBtn.style.color = '';
                }, 2000);
            }
        }).catch(() => {
            this.showError('Failed to copy. Please try again.');
        });
    }

    showSuccess(message) {
        const container = document.getElementById('outputContainer');
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
        const container = document.getElementById('outputContainer');
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
        const outputContainer = document.getElementById('outputContainer');
        if (outputContainer) {
            outputContainer.innerHTML = `
                <div class="output-placeholder">
                    <i class="fas fa-code" style="font-size: 2.5rem; opacity: 0.5;"></i>
                    <p>Your generated text will appear here</p>
                    <small>Select a pattern and click Generate</small>
                </div>
            `;
        }
        const outputStats = document.getElementById('outputStats');
        if (outputStats) {
            outputStats.textContent = '0 lines, 0 characters';
        }
        this.currentPattern = null;
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

// Initialize text repeater module
const textRepeaterModule = new TextRepeaterModule();
window.textRepeaterModule = textRepeaterModule;