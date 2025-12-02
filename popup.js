document.addEventListener('DOMContentLoaded', () => {
    const tabs = Array.from(document.querySelectorAll('[data-target]'));
    const tabPanels = Array.from(document.querySelectorAll('.tab-content'));
    const closeButton = document.querySelector('.modal__close');
    const modal = document.querySelector('.modal');

    function activateTab(targetId) {
        tabs.forEach((button) => {
            const isActive = button.dataset.target === targetId;
            button.classList.toggle('tab--active', isActive);
            button.setAttribute('aria-selected', String(isActive));
            button.tabIndex = isActive ? 0 : -1;
        });

        tabPanels.forEach((panel) => {
            const isActive = panel.id === targetId;
            panel.classList.toggle('tab-content--active', isActive);
            panel.hidden = !isActive;
        });
    }

    tabs.forEach((button) => {
        button.addEventListener('click', () => activateTab(button.dataset.target));
    });

    closeButton?.addEventListener('click', () => {
        modal?.classList.add('is-closing');
        window.setTimeout(() => window.close(), 150);
    });
});
