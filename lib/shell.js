// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
import { classes, DockPanelSvg, LabIcon } from '@jupyterlab/ui-components';
import { ArrayExt, find, iter, toArray } from '@lumino/algorithm';
import { PromiseDelegate, Token } from '@lumino/coreutils';
import { MessageLoop } from '@lumino/messaging';
import { Debouncer } from '@lumino/polling';
import { Signal } from '@lumino/signaling';
import { BoxLayout, BoxPanel, FocusTracker, Panel, SplitPanel, StackedPanel, TabBar, Widget } from '@lumino/widgets';
/**
 * The class name added to AppShell instances.
 */
const APPLICATION_SHELL_CLASS = 'jp-LabShell';
/**
 * The class name added to side bar instances.
 */
const SIDEBAR_CLASS = 'jp-SideBar';
/**
 * The class name added to the current widget's title.
 */
const CURRENT_CLASS = 'jp-mod-current';
/**
 * The class name added to the active widget's title.
 */
const ACTIVE_CLASS = 'jp-mod-active';
/**
 * The default rank of items added to a sidebar.
 */
const DEFAULT_RANK = 500;
const ACTIVITY_CLASS = 'jp-Activity';
/* tslint:disable */
/**
 * The JupyterLab application shell token.
 */
export const ILabShell = new Token('@jupyterlab/application:ILabShell');
/**
 * The application shell for JupyterLab.
 */
export class LabShell extends Widget {
    /**
     * Construct a new application shell.
     */
    constructor() {
        super();
        /**
         * A message hook for child add/remove messages on the main area dock panel.
         */
        this._dockChildHook = (handler, msg) => {
            switch (msg.type) {
                case 'child-added':
                    msg.child.addClass(ACTIVITY_CLASS);
                    this._tracker.add(msg.child);
                    break;
                case 'child-removed':
                    msg.child.removeClass(ACTIVITY_CLASS);
                    this._tracker.remove(msg.child);
                    break;
                default:
                    break;
            }
            return true;
        };
        this._activeChanged = new Signal(this);
        this._cachedLayout = null;
        this._currentChanged = new Signal(this);
        this._isRestored = false;
        this._layoutModified = new Signal(this);
        this._layoutDebouncer = new Debouncer(() => {
            this._layoutModified.emit(undefined);
        }, 0);
        this._restored = new PromiseDelegate();
        this._tracker = new FocusTracker();
        this._mainOptionsCache = new Map();
        this._sideOptionsCache = new Map();
        this.addClass(APPLICATION_SHELL_CLASS);
        this.id = 'main';
        // titlebar
        let titleHeaderPanel = new Panel();
        let headerPanel = (this._headerPanel = new BoxPanel());
        let topHandler = (this._topHandler = new Private.PanelHandler());
        let bottomPanel = (this._bottomPanel = new BoxPanel());
        let hboxPanel = new BoxPanel();
        let dockPanel = (this._dockPanel = new DockPanelSvg());
        MessageLoop.installMessageHook(dockPanel, this._dockChildHook);
        let hsplitPanel = new SplitPanel();
        let leftHandler = (this._leftHandler = new Private.SideBarHandler());
        let rightHandler = (this._rightHandler = new Private.SideBarHandler());
        let rootLayout = new BoxLayout();
        // 标题栏
        titleHeaderPanel.addClass('title-bar-class');
        titleHeaderPanel.node.innerText = 'Notebook';
        titleHeaderPanel.id = 'jp-top-head-panel-test';
        headerPanel.id = 'jp-header-panel';
        topHandler.panel.id = 'jp-top-panel';
        bottomPanel.id = 'jp-bottom-panel';
        hboxPanel.id = 'jp-main-content-panel';
        dockPanel.id = 'jp-main-dock-panel';
        hsplitPanel.id = 'jp-main-split-panel';
        leftHandler.sideBar.addClass(SIDEBAR_CLASS);
        leftHandler.sideBar.addClass('jp-mod-left');
        leftHandler.stackedPanel.id = 'jp-left-stack';
        rightHandler.sideBar.addClass(SIDEBAR_CLASS);
        rightHandler.sideBar.addClass('jp-mod-right');
        rightHandler.stackedPanel.id = 'jp-right-stack';
        hboxPanel.spacing = 0;
        dockPanel.spacing = 5;
        hsplitPanel.spacing = 1;
        // titleHeaderPanel.direction = 'top-to-bottom';
        headerPanel.direction = 'top-to-bottom';
        hboxPanel.direction = 'left-to-right';
        hsplitPanel.orientation = 'horizontal';
        bottomPanel.direction = 'bottom-to-top';
        SplitPanel.setStretch(leftHandler.stackedPanel, 0);
        SplitPanel.setStretch(dockPanel, 1);
        SplitPanel.setStretch(rightHandler.stackedPanel, 0);
        BoxPanel.setStretch(leftHandler.sideBar, 0);
        BoxPanel.setStretch(hsplitPanel, 1);
        BoxPanel.setStretch(rightHandler.sideBar, 0);
        hsplitPanel.addWidget(leftHandler.stackedPanel);
        hsplitPanel.addWidget(dockPanel);
        hsplitPanel.addWidget(rightHandler.stackedPanel);
        hboxPanel.addWidget(leftHandler.sideBar);
        hboxPanel.addWidget(hsplitPanel);
        hboxPanel.addWidget(rightHandler.sideBar);
        rootLayout.direction = 'top-to-bottom';
        rootLayout.spacing = 0; // TODO make this configurable?
        // Use relative sizing to set the width of the side panels.
        // This will still respect the min-size of children widget in the stacked
        // panel.
        hsplitPanel.setRelativeSizes([1, 2.5, 1]);
        BoxLayout.setStretch(titleHeaderPanel, 0);
        BoxLayout.setStretch(headerPanel, 0);
        BoxLayout.setStretch(topHandler.panel, 0);
        BoxLayout.setStretch(hboxPanel, 1);
        BoxLayout.setStretch(bottomPanel, 0);
        rootLayout.addWidget(titleHeaderPanel);
        rootLayout.addWidget(headerPanel);
        rootLayout.addWidget(topHandler.panel);
        rootLayout.addWidget(hboxPanel);
        rootLayout.addWidget(bottomPanel);
        // initially hiding header and bottom panel when no elements inside
        this._headerPanel.hide();
        this._bottomPanel.hide();
        this.layout = rootLayout;
        // Connect change listeners.
        this._tracker.currentChanged.connect(this._onCurrentChanged, this);
        this._tracker.activeChanged.connect(this._onActiveChanged, this);
        // Connect main layout change listener.
        this._dockPanel.layoutModified.connect(this._onLayoutModified, this);
        // Catch current changed events on the side handlers.
        this._leftHandler.sideBar.currentChanged.connect(this._onLayoutModified, this);
        this._rightHandler.sideBar.currentChanged.connect(this._onLayoutModified, this);
    }
    /**
     * A signal emitted when main area's active focus changes.
     */
    get activeChanged() {
        return this._activeChanged;
    }
    /**
     * The active widget in the shell's main area.
     */
    get activeWidget() {
        return this._tracker.activeWidget;
    }
    /**
     * A signal emitted when main area's current focus changes.
     */
    get currentChanged() {
        return this._currentChanged;
    }
    /**
     * The current widget in the shell's main area.
     */
    get currentWidget() {
        return this._tracker.currentWidget;
    }
    /**
     * A signal emitted when the main area's layout is modified.
     */
    get layoutModified() {
        return this._layoutModified;
    }
    /**
     * Whether the left area is collapsed.
     */
    get leftCollapsed() {
        return !this._leftHandler.sideBar.currentTitle;
    }
    /**
     * Whether the left area is collapsed.
     */
    get rightCollapsed() {
        return !this._rightHandler.sideBar.currentTitle;
    }
    /**
     * Whether JupyterLab is in presentation mode with the
     * `jp-mod-presentationMode` CSS class.
     */
    get presentationMode() {
        return this.hasClass('jp-mod-presentationMode');
    }
    /**
     * Enable/disable presentation mode (`jp-mod-presentationMode` CSS class) with
     * a boolean.
     */
    set presentationMode(value) {
        this.toggleClass('jp-mod-presentationMode', value);
    }
    /**
     * The main dock area's user interface mode.
     */
    get mode() {
        return this._dockPanel.mode;
    }
    set mode(mode) {
        const dock = this._dockPanel;
        if (mode === dock.mode) {
            return;
        }
        const applicationCurrentWidget = this.currentWidget;
        if (mode === 'single-document') {
            this._cachedLayout = dock.saveLayout();
            dock.mode = mode;
            // In case the active widget in the dock panel is *not* the active widget
            // of the application, defer to the application.
            if (this.currentWidget) {
                dock.activateWidget(this.currentWidget);
            }
            // Set the mode data attribute on the application shell node.
            this.node.dataset.shellMode = mode;
            return;
        }
        // Cache a reference to every widget currently in the dock panel.
        const widgets = toArray(dock.widgets());
        // Toggle back to multiple document mode.
        dock.mode = mode;
        // Restore the original layout.
        if (this._cachedLayout) {
            // Remove any disposed widgets in the cached layout and restore.
            Private.normalizeAreaConfig(dock, this._cachedLayout.main);
            dock.restoreLayout(this._cachedLayout);
            this._cachedLayout = null;
        }
        // Add any widgets created during single document mode, which have
        // subsequently been removed from the dock panel after the multiple document
        // layout has been restored. If the widget has add options cached for
        // it (i.e., if it has been placed with respect to another widget),
        // then take that into account.
        widgets.forEach(widget => {
            if (!widget.parent) {
                this._addToMainArea(widget, Object.assign(Object.assign({}, this._mainOptionsCache.get(widget)), { activate: false }));
            }
        });
        this._mainOptionsCache.clear();
        // In case the active widget in the dock panel is *not* the active widget
        // of the application, defer to the application.
        if (applicationCurrentWidget) {
            dock.activateWidget(applicationCurrentWidget);
        }
        // Set the mode data attribute on the applications shell node.
        this.node.dataset.shellMode = mode;
    }
    /**
     * Promise that resolves when state is first restored, returning layout
     * description.
     */
    get restored() {
        return this._restored.promise;
    }
    /**
     * Activate a widget in its area.
     */
    activateById(id) {
        if (this._leftHandler.has(id)) {
            this._leftHandler.activate(id);
            return;
        }
        if (this._rightHandler.has(id)) {
            this._rightHandler.activate(id);
            return;
        }
        const dock = this._dockPanel;
        const widget = find(dock.widgets(), value => value.id === id);
        if (widget) {
            dock.activateWidget(widget);
        }
    }
    /*
     * Activate the next Tab in the active TabBar.
     */
    activateNextTab() {
        let current = this._currentTabBar();
        if (!current) {
            return;
        }
        let ci = current.currentIndex;
        if (ci === -1) {
            return;
        }
        if (ci < current.titles.length - 1) {
            current.currentIndex += 1;
            if (current.currentTitle) {
                current.currentTitle.owner.activate();
            }
            return;
        }
        if (ci === current.titles.length - 1) {
            let nextBar = this._adjacentBar('next');
            if (nextBar) {
                nextBar.currentIndex = 0;
                if (nextBar.currentTitle) {
                    nextBar.currentTitle.owner.activate();
                }
            }
        }
    }
    /*
     * Activate the previous Tab in the active TabBar.
     */
    activatePreviousTab() {
        let current = this._currentTabBar();
        if (!current) {
            return;
        }
        let ci = current.currentIndex;
        if (ci === -1) {
            return;
        }
        if (ci > 0) {
            current.currentIndex -= 1;
            if (current.currentTitle) {
                current.currentTitle.owner.activate();
            }
            return;
        }
        if (ci === 0) {
            let prevBar = this._adjacentBar('previous');
            if (prevBar) {
                let len = prevBar.titles.length;
                prevBar.currentIndex = len - 1;
                if (prevBar.currentTitle) {
                    prevBar.currentTitle.owner.activate();
                }
            }
        }
    }
    /*
     * Activate the next TabBar.
     */
    activateNextTabBar() {
        let nextBar = this._adjacentBar('next');
        if (nextBar) {
            if (nextBar.currentTitle) {
                nextBar.currentTitle.owner.activate();
            }
        }
    }
    /*
     * Activate the next TabBar.
     */
    activatePreviousTabBar() {
        let nextBar = this._adjacentBar('previous');
        if (nextBar) {
            if (nextBar.currentTitle) {
                nextBar.currentTitle.owner.activate();
            }
        }
    }
    add(widget, area = 'main', options) {
        switch (area || 'main') {
            case 'main':
                return this._addToMainArea(widget, options);
            case 'left':
                return this._addToLeftArea(widget, options);
            case 'right':
                return this._addToRightArea(widget, options);
            case 'header':
                return this._addToHeaderArea(widget, options);
            case 'top':
                return this._addToTopArea(widget, options);
            case 'bottom':
                return this._addToBottomArea(widget, options);
            default:
                throw new Error(`Invalid area: ${area}`);
        }
    }
    /**
     * Collapse the left area.
     */
    collapseLeft() {
        this._leftHandler.collapse();
        this._onLayoutModified();
    }
    /**
     * Collapse the right area.
     */
    collapseRight() {
        this._rightHandler.collapse();
        this._onLayoutModified();
    }
    /**
     * Dispose the shell.
     */
    dispose() {
        if (this.isDisposed) {
            return;
        }
        this._layoutDebouncer.dispose();
        super.dispose();
    }
    /**
     * Expand the left area.
     *
     * #### Notes
     * This will open the most recently used tab,
     * or the first tab if there is no most recently used.
     */
    expandLeft() {
        this._leftHandler.expand();
        this._onLayoutModified();
    }
    /**
     * Expand the right area.
     *
     * #### Notes
     * This will open the most recently used tab,
     * or the first tab if there is no most recently used.
     */
    expandRight() {
        this._rightHandler.expand();
        this._onLayoutModified();
    }
    /**
     * Close all widgets in the main area.
     */
    closeAll() {
        // Make a copy of all the widget in the dock panel (using `toArray()`)
        // before removing them because removing them while iterating through them
        // modifies the underlying data of the iterator.
        toArray(this._dockPanel.widgets()).forEach(widget => widget.close());
    }
    /**
     * True if the given area is empty.
     */
    isEmpty(area) {
        switch (area) {
            case 'left':
                return this._leftHandler.stackedPanel.widgets.length === 0;
            case 'main':
                return this._dockPanel.isEmpty;
            case 'header':
                return this._headerPanel.widgets.length === 0;
            case 'top':
                return this._topHandler.panel.widgets.length === 0;
            case 'bottom':
                return this._bottomPanel.widgets.length === 0;
            case 'right':
                return this._rightHandler.stackedPanel.widgets.length === 0;
            default:
                return true;
        }
    }
    /**
     * Restore the layout state for the application shell.
     */
    restoreLayout(layout) {
        const { mainArea, leftArea, rightArea } = layout;
        // Rehydrate the main area.
        if (mainArea) {
            const { currentWidget, dock, mode } = mainArea;
            if (dock) {
                this._dockPanel.restoreLayout(dock);
            }
            if (mode) {
                this.mode = mode;
            }
            if (currentWidget) {
                this.activateById(currentWidget.id);
            }
        }
        // Rehydrate the left area.
        if (leftArea) {
            this._leftHandler.rehydrate(leftArea);
        }
        // Rehydrate the right area.
        if (rightArea) {
            this._rightHandler.rehydrate(rightArea);
        }
        if (!this._isRestored) {
            // Make sure all messages in the queue are finished before notifying
            // any extensions that are waiting for the promise that guarantees the
            // application state has been restored.
            MessageLoop.flush();
            this._restored.resolve(layout);
        }
    }
    /**
     * Save the dehydrated state of the application shell.
     */
    saveLayout() {
        // If the application is in single document mode, use the cached layout if
        // available. Otherwise, default to querying the dock panel for layout.
        return {
            mainArea: {
                currentWidget: this._tracker.currentWidget,
                dock: this.mode === 'single-document'
                    ? this._cachedLayout || this._dockPanel.saveLayout()
                    : this._dockPanel.saveLayout(),
                mode: this._dockPanel.mode
            },
            leftArea: this._leftHandler.dehydrate(),
            rightArea: this._rightHandler.dehydrate()
        };
    }
    /**
     * Returns the widgets for an application area.
     */
    widgets(area) {
        switch (area || 'main') {
            case 'main':
                return this._dockPanel.widgets();
            case 'left':
                return iter(this._leftHandler.sideBar.titles.map(t => t.owner));
            case 'right':
                return iter(this._rightHandler.sideBar.titles.map(t => t.owner));
            case 'header':
                return this._headerPanel.children();
            case 'top':
                return this._topHandler.panel.children();
            case 'bottom':
                return this._bottomPanel.children();
            default:
                throw new Error(`Invalid area: ${area}`);
        }
    }
    /**
     * Handle `after-attach` messages for the application shell.
     */
    onAfterAttach(msg) {
        this.node.dataset.shellMode = this.mode;
    }
    /**
     * Add a widget to the left content area.
     *
     * #### Notes
     * Widgets must have a unique `id` property, which will be used as the DOM id.
     */
    _addToLeftArea(widget, options) {
        if (!widget.id) {
            console.error('Widgets added to app shell must have unique id property.');
            return;
        }
        options = options || this._sideOptionsCache.get(widget) || {};
        this._sideOptionsCache.set(widget, options);
        let rank = 'rank' in options ? options.rank : DEFAULT_RANK;
        this._leftHandler.addWidget(widget, rank);
        this._onLayoutModified();
    }
    /**
     * Add a widget to the main content area.
     *
     * #### Notes
     * Widgets must have a unique `id` property, which will be used as the DOM id.
     * All widgets added to the main area should be disposed after removal
     * (disposal before removal will remove the widget automatically).
     *
     * In the options, `ref` defaults to `null`, `mode` defaults to `'tab-after'`,
     * and `activate` defaults to `true`.
     */
    _addToMainArea(widget, options) {
        if (!widget.id) {
            console.error('Widgets added to app shell must have unique id property.');
            return;
        }
        options = options || {};
        const dock = this._dockPanel;
        const mode = options.mode || 'tab-after';
        let ref = this.currentWidget;
        if (options.ref) {
            ref = find(dock.widgets(), value => value.id === options.ref) || null;
        }
        const { title } = widget;
        // Add widget ID to tab so that we can get a handle on the tab's widget
        // (for context menu support)
        title.dataset = Object.assign(Object.assign({}, title.dataset), { id: widget.id });
        if (title.icon instanceof LabIcon) {
            // bind an appropriate style to the icon
            title.icon = title.icon.bindprops({
                stylesheet: 'mainAreaTab'
            });
        }
        else if (typeof title.icon === 'string' || !title.icon) {
            // add some classes to help with displaying css background imgs
            title.iconClass = classes(title.iconClass, 'jp-Icon');
        }
        dock.addWidget(widget, { mode, ref });
        // The dock panel doesn't account for placement information while
        // in single document mode, so upon rehydrating any widgets that were
        // added will not be in the correct place. Cache the placement information
        // here so that we can later rehydrate correctly.
        if (dock.mode === 'single-document') {
            this._mainOptionsCache.set(widget, options);
        }
        if (options.activate !== false) {
            dock.activateWidget(widget);
        }
    }
    /**
     * Add a widget to the right content area.
     *
     * #### Notes
     * Widgets must have a unique `id` property, which will be used as the DOM id.
     */
    _addToRightArea(widget, options) {
        if (!widget.id) {
            console.error('Widgets added to app shell must have unique id property.');
            return;
        }
        options = options || this._sideOptionsCache.get(widget) || {};
        const rank = 'rank' in options ? options.rank : DEFAULT_RANK;
        this._sideOptionsCache.set(widget, options);
        this._rightHandler.addWidget(widget, rank);
        this._onLayoutModified();
    }
    /**
     * Add a widget to the top content area.
     *
     * #### Notes
     * Widgets must have a unique `id` property, which will be used as the DOM id.
     */
    _addToTopArea(widget, options) {
        var _a;
        if (!widget.id) {
            console.error('Widgets added to app shell must have unique id property.');
            return;
        }
        options = options || {};
        const rank = (_a = options.rank, (_a !== null && _a !== void 0 ? _a : DEFAULT_RANK));
        this._topHandler.addWidget(widget, rank);
        this._onLayoutModified();
        if (this._topHandler.panel.isHidden) {
            this._topHandler.panel.show();
        }
    }
    /**
     * Add a widget to the header content area.
     *
     * #### Notes
     * Widgets must have a unique `id` property, which will be used as the DOM id.
     */
    _addToHeaderArea(widget, options) {
        if (!widget.id) {
            console.error('Widgets added to app shell must have unique id property.');
            return;
        }
        // Temporary: widgets are added to the panel in order of insertion.
        this._headerPanel.addWidget(widget);
        this._onLayoutModified();
        if (this._headerPanel.isHidden) {
            this._headerPanel.show();
        }
    }
    /**
     * Add a widget to the bottom content area.
     *
     * #### Notes
     * Widgets must have a unique `id` property, which will be used as the DOM id.
     */
    _addToBottomArea(widget, options) {
        if (!widget.id) {
            console.error('Widgets added to app shell must have unique id property.');
            return;
        }
        // Temporary: widgets are added to the panel in order of insertion.
        this._bottomPanel.addWidget(widget);
        this._onLayoutModified();
        if (this._bottomPanel.isHidden) {
            this._bottomPanel.show();
        }
    }
    /*
     * Return the tab bar adjacent to the current TabBar or `null`.
     */
    _adjacentBar(direction) {
        const current = this._currentTabBar();
        if (!current) {
            return null;
        }
        const bars = toArray(this._dockPanel.tabBars());
        const len = bars.length;
        const index = bars.indexOf(current);
        if (direction === 'previous') {
            return index > 0 ? bars[index - 1] : index === 0 ? bars[len - 1] : null;
        }
        // Otherwise, direction is 'next'.
        return index < len - 1
            ? bars[index + 1]
            : index === len - 1
                ? bars[0]
                : null;
    }
    /*
     * Return the TabBar that has the currently active Widget or null.
     */
    _currentTabBar() {
        const current = this._tracker.currentWidget;
        if (!current) {
            return null;
        }
        const title = current.title;
        const bars = this._dockPanel.tabBars();
        return find(bars, bar => bar.titles.indexOf(title) > -1) || null;
    }
    /**
     * Handle a change to the dock area active widget.
     */
    _onActiveChanged(sender, args) {
        if (args.newValue) {
            args.newValue.title.className += ` ${ACTIVE_CLASS}`;
        }
        if (args.oldValue) {
            args.oldValue.title.className = args.oldValue.title.className.replace(ACTIVE_CLASS, '');
        }
        this._activeChanged.emit(args);
    }
    /**
     * Handle a change to the dock area current widget.
     */
    _onCurrentChanged(sender, args) {
        if (args.newValue) {
            args.newValue.title.className += ` ${CURRENT_CLASS}`;
        }
        if (args.oldValue) {
            args.oldValue.title.className = args.oldValue.title.className.replace(CURRENT_CLASS, '');
        }
        this._currentChanged.emit(args);
        this._onLayoutModified();
    }
    /**
     * Handle a change to the layout.
     */
    _onLayoutModified() {
        void this._layoutDebouncer.invoke();
    }
}
var Private;
(function (Private) {
    /**
     * A less-than comparison function for side bar rank items.
     */
    function itemCmp(first, second) {
        return first.rank - second.rank;
    }
    Private.itemCmp = itemCmp;
    /**
     * Removes widgets that have been disposed from an area config, mutates area.
     */
    function normalizeAreaConfig(parent, area) {
        if (!area) {
            return;
        }
        if (area.type === 'tab-area') {
            area.widgets = area.widgets.filter(widget => !widget.isDisposed && widget.parent === parent);
            return;
        }
        area.children.forEach(child => {
            normalizeAreaConfig(parent, child);
        });
    }
    Private.normalizeAreaConfig = normalizeAreaConfig;
    /**
     * A class which manages a panel and sorts its widgets by rank.
     */
    class PanelHandler {
        constructor() {
            this._items = new Array();
            this._panel = new Panel();
        }
        /**
         * Get the panel managed by the handler.
         */
        get panel() {
            return this._panel;
        }
        /**
         * Add a widget to the panel.
         *
         * If the widget is already added, it will be moved.
         */
        addWidget(widget, rank) {
            widget.parent = null;
            const item = { widget, rank };
            const index = ArrayExt.upperBound(this._items, item, Private.itemCmp);
            ArrayExt.insert(this._items, index, item);
            this._panel.insertWidget(index, widget);
        }
    }
    Private.PanelHandler = PanelHandler;
    /**
     * A class which manages a side bar and related stacked panel.
     */
    class SideBarHandler {
        /**
         * Construct a new side bar handler.
         */
        constructor() {
            this._items = new Array();
            this._sideBar = new TabBar({
                insertBehavior: 'none',
                removeBehavior: 'none',
                allowDeselect: true
            });
            this._stackedPanel = new StackedPanel();
            this._sideBar.hide();
            this._stackedPanel.hide();
            this._lastCurrent = null;
            this._sideBar.currentChanged.connect(this._onCurrentChanged, this);
            this._sideBar.tabActivateRequested.connect(this._onTabActivateRequested, this);
            this._stackedPanel.widgetRemoved.connect(this._onWidgetRemoved, this);
        }
        /**
         * Get the tab bar managed by the handler.
         */
        get sideBar() {
            return this._sideBar;
        }
        /**
         * Get the stacked panel managed by the handler
         */
        get stackedPanel() {
            return this._stackedPanel;
        }
        /**
         * Expand the sidebar.
         *
         * #### Notes
         * This will open the most recently used tab, or the first tab
         * if there is no most recently used.
         */
        expand() {
            const previous = this._lastCurrent || (this._items.length > 0 && this._items[0].widget);
            if (previous) {
                this.activate(previous.id);
            }
        }
        /**
         * Activate a widget residing in the side bar by ID.
         *
         * @param id - The widget's unique ID.
         */
        activate(id) {
            let widget = this._findWidgetByID(id);
            if (widget) {
                this._sideBar.currentTitle = widget.title;
                widget.activate();
            }
        }
        /**
         * Test whether the sidebar has the given widget by id.
         */
        has(id) {
            return this._findWidgetByID(id) !== null;
        }
        /**
         * Collapse the sidebar so no items are expanded.
         */
        collapse() {
            this._sideBar.currentTitle = null;
        }
        /**
         * Add a widget and its title to the stacked panel and side bar.
         *
         * If the widget is already added, it will be moved.
         */
        addWidget(widget, rank) {
            widget.parent = null;
            widget.hide();
            let item = { widget, rank };
            let index = this._findInsertIndex(item);
            ArrayExt.insert(this._items, index, item);
            this._stackedPanel.insertWidget(index, widget);
            const title = this._sideBar.insertTab(index, widget.title);
            // Store the parent id in the title dataset
            // in order to dispatch click events to the right widget.
            title.dataset = { id: widget.id };
            if (title.icon instanceof LabIcon) {
                // bind an appropriate style to the icon
                title.icon = title.icon.bindprops({
                    stylesheet: 'sideBar'
                });
            }
            else if (typeof title.icon === 'string' || !title.icon) {
                // add some classes to help with displaying css background imgs
                title.iconClass = classes(title.iconClass, 'jp-Icon', 'jp-Icon-20');
            }
            this._refreshVisibility();
        }
        /**
         * Dehydrate the side bar data.
         */
        dehydrate() {
            let collapsed = this._sideBar.currentTitle === null;
            let widgets = toArray(this._stackedPanel.widgets);
            let currentWidget = widgets[this._sideBar.currentIndex];
            return { collapsed, currentWidget, widgets };
        }
        /**
         * Rehydrate the side bar.
         */
        rehydrate(data) {
            if (data.currentWidget) {
                this.activate(data.currentWidget.id);
            }
            else if (data.collapsed) {
                this.collapse();
            }
        }
        /**
         * Find the insertion index for a rank item.
         */
        _findInsertIndex(item) {
            return ArrayExt.upperBound(this._items, item, Private.itemCmp);
        }
        /**
         * Find the index of the item with the given widget, or `-1`.
         */
        _findWidgetIndex(widget) {
            return ArrayExt.findFirstIndex(this._items, i => i.widget === widget);
        }
        /**
         * Find the widget which owns the given title, or `null`.
         */
        _findWidgetByTitle(title) {
            let item = find(this._items, value => value.widget.title === title);
            return item ? item.widget : null;
        }
        /**
         * Find the widget with the given id, or `null`.
         */
        _findWidgetByID(id) {
            let item = find(this._items, value => value.widget.id === id);
            return item ? item.widget : null;
        }
        /**
         * Refresh the visibility of the side bar and stacked panel.
         */
        _refreshVisibility() {
            this._sideBar.setHidden(this._sideBar.titles.length === 0);
            this._stackedPanel.setHidden(this._sideBar.currentTitle === null);
        }
        /**
         * Handle the `currentChanged` signal from the sidebar.
         */
        _onCurrentChanged(sender, args) {
            const oldWidget = args.previousTitle
                ? this._findWidgetByTitle(args.previousTitle)
                : null;
            const newWidget = args.currentTitle
                ? this._findWidgetByTitle(args.currentTitle)
                : null;
            if (oldWidget) {
                oldWidget.hide();
            }
            if (newWidget) {
                newWidget.show();
            }
            this._lastCurrent = newWidget || oldWidget;
            this._refreshVisibility();
        }
        /**
         * Handle a `tabActivateRequest` signal from the sidebar.
         */
        _onTabActivateRequested(sender, args) {
            args.title.owner.activate();
        }
        /*
         * Handle the `widgetRemoved` signal from the stacked panel.
         */
        _onWidgetRemoved(sender, widget) {
            if (widget === this._lastCurrent) {
                this._lastCurrent = null;
            }
            ArrayExt.removeAt(this._items, this._findWidgetIndex(widget));
            this._sideBar.removeTab(widget.title);
            this._refreshVisibility();
        }
    }
    Private.SideBarHandler = SideBarHandler;
})(Private || (Private = {}));
//# sourceMappingURL=shell.js.map