const AI = {
    state: null,

    getConfig: () => {
        return JSON.parse(localStorage.getItem('ospos_ai_config') || '{"provider":"openai","baseUrl":"https://api.openai.com/v1","apiKey":"","model":"gpt-4-turbo-preview"}');
    },

    init: (appState) => {
        AI.state = appState;
        document.getElementById('ai-settings-btn').onclick = AI.openSettings;
        document.getElementById('ai-provider').onchange = AI.handleProviderChange;
        document.getElementById('save-ai-settings').onclick = AI.saveSettings;
        document.getElementById('test-ai-connection').onclick = AI.testConnection;
    },

    openSettings: () => {
        const config = AI.state.aiConfig;
        document.getElementById('ai-provider').value = config.provider;
        document.getElementById('ai-base-url').value = config.baseUrl;
        document.getElementById('ai-api-key').value = config.apiKey;
        document.getElementById('ai-model').value = config.model;
        document.getElementById('ai-connection-status').innerText = '';
        document.getElementById('ai-settings-modal').classList.remove('hidden');
    },

    closeSettings: () => {
        document.getElementById('ai-settings-modal').classList.add('hidden');
    },

    handleProviderChange: (e) => {
        const val = e.target.value;
        if (val === 'openai') {
            document.getElementById('ai-base-url').value = 'https://api.openai.com/v1';
            document.getElementById('ai-model').value = 'gpt-4-turbo-preview';
        } else if (val === 'lmstudio') {
            document.getElementById('ai-base-url').value = 'http://localhost:1234/v1';
            document.getElementById('ai-model').value = 'local-model';
        }
    },

    testConnection: async () => {
        const baseUrl = document.getElementById('ai-base-url').value.replace(/\/+$/, '');
        const apiKey = document.getElementById('ai-api-key').value.trim();
        const model = document.getElementById('ai-model').value || 'local-model';
        const statusEl = document.getElementById('ai-connection-status');

        statusEl.className = 'text-center text-[10px] font-bold mt-2 text-slate-500';
        statusEl.innerHTML = '<i data-lucide="loader-2" class="w-3 h-3 animate-spin inline mr-1"></i> Testing...';
        if (window.lucide) window.lucide.createIcons();

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const headers = { 'Content-Type': 'application/json' };
            if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

            const res = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: 'user', content: 'Test' }],
                    max_tokens: 1
                }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error?.message || `HTTP ${res.status}`);
            }

            statusEl.className = 'text-center text-[10px] font-bold mt-2 text-emerald-600';
            statusEl.innerHTML = '<i data-lucide="check-circle" class="w-3 h-3 inline mr-1"></i> Connection Verified';
            if (window.lucide) window.lucide.createIcons();
        } catch (e) {
            console.error("AI Connection Error:", e);
            let msg = e.message;
            if (e.name === 'TypeError' && msg === 'Failed to fetch') {
                msg = 'CORS/Network Error. Enable CORS in LM Studio (Server Options).';
            }
            statusEl.className = 'text-center text-[10px] font-bold mt-2 text-rose-600';
            statusEl.innerText = `Error: ${msg}`;
        }
    },

    saveSettings: () => {
        AI.state.aiConfig = {
            provider: document.getElementById('ai-provider').value,
            baseUrl: document.getElementById('ai-base-url').value,
            apiKey: document.getElementById('ai-api-key').value,
            model: document.getElementById('ai-model').value
        };
        localStorage.setItem('ospos_ai_config', JSON.stringify(AI.state.aiConfig));
        AI.closeSettings();
    },

    runBatchCategorization: async (items, allCategories, onBatchComplete, batchSize = 50) => {
        const total = items.length;
        const config = AI.state.aiConfig;
        
        if (!config.apiKey && config.provider === 'openai') {
            alert("Please configure AI API Key first.");
            return;
        }

        const callAI = async (prompt) => {
             const baseUrl = config.baseUrl.replace(/\/+$/, '');
             const headers = { 'Content-Type': 'application/json' };
             if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

             const res = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    model: config.model,
                    messages: [
                        { role: 'system', content: 'You are a helpful data assistant. Output strictly JSON.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1
                })
            });
            if (!res.ok) {
                const err = await res.json().catch(()=>({}));
                throw new Error(err.error?.message || res.statusText);
            }
            const data = await res.json();
            return data.choices[0].message.content;
        };

        for (let i = 0; i < total; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            const prompt = `You are an expert retail category manager.\nI have a list of items that need to be categorized.\nHere is the list of EXISTING categories in the system:\n${JSON.stringify(allCategories)}\n\nHere are the items to categorize (Format: ID | Item Name):\n${batch.map(item => `${item.originalIdx} | ${item.item_name}`).join('\n')}\n\nINSTRUCTIONS:\n1. For each item, select the most appropriate category from the EXISTING list.\n2. If the item definitely does not fit any existing category, you may suggest a new concise category name.\n3. Return the result as a JSON ARRAY of objects.\n4. Format: [{"id": 123, "category": "Category Name"}, ...]\n5. Do NOT output markdown code blocks. Just the raw JSON string.`;

            try {
                const responseText = await callAI(prompt);
                let cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
                const firstBracket = cleanText.indexOf('[');
                const lastBracket = cleanText.lastIndexOf(']');
                if (firstBracket !== -1 && lastBracket !== -1) cleanText = cleanText.substring(firstBracket, lastBracket + 1);
                
                const updates = JSON.parse(cleanText);
                if (onBatchComplete) await onBatchComplete(updates, Math.min(i + batchSize, total), total);
            } catch (e) {
                console.error("AI Batch Error:", e);
            }
        }
    },

    findCategoryMerges: async (categories) => {
        const config = AI.state.aiConfig;
        if (!config.apiKey && config.provider === 'openai') {
            throw new Error("Please configure AI API Key first.");
        }

        const baseUrl = config.baseUrl.replace(/\/+$/, '');
        const headers = { 'Content-Type': 'application/json' };
        if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

        const prompt = `You are a data cleaning assistant. I have a list of retail product categories. Identify pairs that are likely duplicates, abbreviations, or variations of each other (e.g., "Bev" and "Beverages", "Cigs" and "Cigarettes").
        
        List of Categories:
        ${JSON.stringify(categories)}
        
        INSTRUCTIONS:
        1. Identify pairs that should be merged.
        2. Determine which is the "Source" (incorrect/shorter/bad name) and which is the "Target" (correct/standard name).
        3. Return a JSON ARRAY of objects: [{"source": "Bad Name", "target": "Good Name", "reason": "Abbreviation"}].
        4. If no obvious merges exist, return [].
        5. Output strictly JSON only. No markdown.`;

        const res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                model: config.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1
            })
        });

        if (!res.ok) throw new Error(res.statusText);
        const data = await res.json();
        let text = data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(text);
    }
};

// Expose closeSettings globally for HTML onclick attributes
window.closeAISettings = AI.closeSettings;