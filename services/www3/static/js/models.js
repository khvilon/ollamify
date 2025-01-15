let modelsUpdateInterval;
let currentModels = [];

function formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function createModelCard(model) {
    const card = document.createElement('div');
    card.className = 'model-card';
    card.dataset.modelName = model.name;
    
    let content = '';
    if (model.status === 'downloading') {
        content = `
            <h3>${model.name}</h3>
            <div class="progress-container">
                <div class="progress-bar" style="width: ${model.progress.percent}%"></div>
            </div>
            <div class="progress-text">
                Downloading: ${model.progress.percent}%
                (${formatBytes(model.progress.downloaded)} / ${formatBytes(model.progress.total)})
            </div>
        `;
    } else {
        content = `
            <h3>${model.name}</h3>
            <div class="model-info">
                <p>Size: ${formatBytes(model.size)}</p>
                <p>Modified: ${new Date(model.modified_at).toLocaleString()}</p>
            </div>
            <div class="model-actions">
                <button onclick="deleteModel('${model.name}')" class="delete-btn">Delete</button>
            </div>
        `;
    }
    
    card.innerHTML = content;
    return card;
}

function updateModels() {
    fetch(`/api/models?timestamp=${Date.now()}`)
        .then(response => {
            if (response.status === 304) {
                // Данные не изменились, пропускаем обновление DOM
                return null;
            }
            return response.json();
        })
        .then(data => {
            if (!data) return; // Пропускаем если 304

            const container = document.getElementById('models-container');
            const oldCards = new Map();
            
            // Сохраняем существующие карточки
            container.querySelectorAll('.model-card').forEach(card => {
                oldCards.set(card.dataset.modelName, card);
            });
            
            // Очищаем контейнер
            container.innerHTML = '';
            
            // Обновляем или создаем карточки
            data.models.forEach(model => {
                const oldCard = oldCards.get(model.name);
                if (oldCard) {
                    // Если карточка существует, обновляем только содержимое
                    const newCard = createModelCard(model);
                    if (oldCard.innerHTML !== newCard.innerHTML) {
                        oldCard.innerHTML = newCard.innerHTML;
                    }
                    container.appendChild(oldCard);
                } else {
                    // Если карточки нет, создаем новую
                    container.appendChild(createModelCard(model));
                }
            });
        })
        .catch(error => {
            console.error('Error fetching models:', error);
        });
}

function deleteModel(name) {
    if (confirm(`Are you sure you want to delete ${name}?`)) {
        fetch(`/api/models/${name}`, {
            method: 'DELETE'
        })
        .then(response => {
            if (response.ok) {
                updateModels();
            } else {
                alert('Failed to delete model');
            }
        })
        .catch(error => {
            console.error('Error deleting model:', error);
            alert('Failed to delete model');
        });
    }
}

// Start updates when the page loads
document.addEventListener('DOMContentLoaded', () => {
    updateModels();
    modelsUpdateInterval = setInterval(updateModels, 1000);
});

// Clean up interval when leaving the page
window.addEventListener('beforeunload', () => {
    if (modelsUpdateInterval) {
        clearInterval(modelsUpdateInterval);
    }
});
