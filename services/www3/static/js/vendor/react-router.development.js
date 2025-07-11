/**
 * React Router v6.21.1
 *
 * Copyright (c) Remix Software Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.md file in the root directory of this source tree.
 *
 * @license MIT
 */
(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('react'), require('@remix-run/router')) :
  typeof define === 'function' && define.amd ? define(['exports', 'react', '@remix-run/router'], factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.ReactRouter = {}, global.React, global.RemixRouter));
})(this, (function (exports, React, router) { 'use strict';

  function _interopNamespace(e) {
    if (e && e.__esModule) return e;
    var n = Object.create(null);
    if (e) {
      Object.keys(e).forEach(function (k) {
        if (k !== 'default') {
          var d = Object.getOwnPropertyDescriptor(e, k);
          Object.defineProperty(n, k, d.get ? d : {
            enumerable: true,
            get: function () { return e[k]; }
          });
        }
      });
    }
    n["default"] = e;
    return Object.freeze(n);
  }

  var React__namespace = /*#__PURE__*/_interopNamespace(React);

  function _extends() {
    _extends = Object.assign ? Object.assign.bind() : function (target) {
      for (var i = 1; i < arguments.length; i++) {
        var source = arguments[i];
        for (var key in source) {
          if (Object.prototype.hasOwnProperty.call(source, key)) {
            target[key] = source[key];
          }
        }
      }
      return target;
    };
    return _extends.apply(this, arguments);
  }

  // Create react-specific types from the agnostic types in @remix-run/router to
  // export from react-router
  const DataRouterContext = /*#__PURE__*/React__namespace.createContext(null);
  {
    DataRouterContext.displayName = "DataRouter";
  }
  const DataRouterStateContext = /*#__PURE__*/React__namespace.createContext(null);
  {
    DataRouterStateContext.displayName = "DataRouterState";
  }
  const AwaitContext = /*#__PURE__*/React__namespace.createContext(null);
  {
    AwaitContext.displayName = "Await";
  }

  /**
   * A Navigator is a "location changer"; it's how you get to different locations.
   *
   * Every history instance conforms to the Navigator interface, but the
   * distinction is useful primarily when it comes to the low-level `<Router>` API
   * where both the location and a navigator must be provided separately in order
   * to avoid "tearing" that may occur in a suspense-enabled app if the action
   * and/or location were to be read directly from the history instance.
   */

  const NavigationContext = /*#__PURE__*/React__namespace.createContext(null);
  {
    NavigationContext.displayName = "Navigation";
  }
  const LocationContext = /*#__PURE__*/React__namespace.createContext(null);
  {
    LocationContext.displayName = "Location";
  }
  const RouteContext = /*#__PURE__*/React__namespace.createContext({
    outlet: null,
    matches: [],
    isDataRoute: false
  });
  {
    RouteContext.displayName = "Route";
  }
  const RouteErrorContext = /*#__PURE__*/React__namespace.createContext(null);
  {
    RouteErrorContext.displayName = "RouteError";
  }

  /**
   * Returns the full href for the given "to" value. This is useful for building
   * custom links that are also accessible and preserve right-click behavior.
   *
   * @see https://reactrouter.com/hooks/use-href
   */
  function useHref(to, _temp) {
    let {
      relative
    } = _temp === void 0 ? {} : _temp;
    !useInRouterContext() ? router.UNSAFE_invariant(false, // TODO: This error is probably because they somehow have 2 versions of the
    // router loaded. We can help them understand how to avoid that.
    "useHref() may be used only in the context of a <Router> component.")  : void 0;
    let {
      basename,
      navigator
    } = React__namespace.useContext(NavigationContext);
    let {
      hash,
      pathname,
      search
    } = useResolvedPath(to, {
      relative
    });
    let joinedPathname = pathname;

    // If we're operating within a basename, prepend it to the pathname prior
    // to creating the href.  If this is a root navigation, then just use the raw
    // basename which allows the basename to have full control over the presence
    // of a trailing slash on root links
    if (basename !== "/") {
      joinedPathname = pathname === "/" ? basename : router.joinPaths([basename, pathname]);
    }
    return navigator.createHref({
      pathname: joinedPathname,
      search,
      hash
    });
  }

  /**
   * Returns true if this component is a descendant of a `<Router>`.
   *
   * @see https://reactrouter.com/hooks/use-in-router-context
   */
  function useInRouterContext() {
    return React__namespace.useContext(LocationContext) != null;
  }

  /**
   * Returns the current location object, which represents the current URL in web
   * browsers.
   *
   * Note: If you're using this it may mean you're doing some of your own
   * "routing" in your app, and we'd like to know what your use case is. We may
   * be able to provide something higher-level to better suit your needs.
   *
   * @see https://reactrouter.com/hooks/use-location
   */
  function useLocation() {
    !useInRouterContext() ? router.UNSAFE_invariant(false, // TODO: This error is probably because they somehow have 2 versions of the
    // router loaded. We can help them understand how to avoid that.
    "useLocation() may be used only in the context of a <Router> component.")  : void 0;
    return React__namespace.useContext(LocationContext).location;
  }

  /**
   * Returns the current navigation action which describes how the router came to
   * the current location, either by a pop, push, or replace on the history stack.
   *
   * @see https://reactrouter.com/hooks/use-navigation-type
   */
  function useNavigationType() {
    return React__namespace.useContext(LocationContext).navigationType;
  }

  /**
   * Returns a PathMatch object if the given pattern matches the current URL.
   * This is useful for components that need to know "active" state, e.g.
   * `<NavLink>`.
   *
   * @see https://reactrouter.com/hooks/use-match
   */
  function useMatch(pattern) {
    !useInRouterContext() ? router.UNSAFE_invariant(false, // TODO: This error is probably because they somehow have 2 versions of the
    // router loaded. We can help them understand how to avoid that.
    "useMatch() may be used only in the context of a <Router> component.")  : void 0;
    let {
      pathname
    } = useLocation();
    return React__namespace.useMemo(() => router.matchPath(pattern, pathname), [pathname, pattern]);
  }

  /**
   * The interface for the navigate() function returned from useNavigate().
   */

  const navigateEffectWarning = "You should call navigate() in a React.useEffect(), not when " + "your component is first rendered.";

  // Mute warnings for calls to useNavigate in SSR environments
  function useIsomorphicLayoutEffect(cb) {
    let isStatic = React__namespace.useContext(NavigationContext).static;
    if (!isStatic) {
      // We should be able to get rid of this once react 18.3 is released
      // See: https://github.com/facebook/react/pull/26395
      // eslint-disable-next-line react-hooks/rules-of-hooks
      React__namespace.useLayoutEffect(cb);
    }
  }

  /**
   * Returns an imperative method for changing the location. Used by `<Link>`s, but
   * may also be used by other elements to change the location.
   *
   * @see https://reactrouter.com/hooks/use-navigate
   */
  function useNavigate() {
    let {
      isDataRoute
    } = React__namespace.useContext(RouteContext);
    // Conditional usage is OK here because the usage of a data router is static
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return isDataRoute ? useNavigateStable() : useNavigateUnstable();
  }
  function useNavigateUnstable() {
    !useInRouterContext() ? router.UNSAFE_invariant(false, // TODO: This error is probably because they somehow have 2 versions of the
    // router loaded. We can help them understand how to avoid that.
    "useNavigate() may be used only in the context of a <Router> component.")  : void 0;
    let dataRouterContext = React__namespace.useContext(DataRouterContext);
    let {
      basename,
      future,
      navigator
    } = React__namespace.useContext(NavigationContext);
    let {
      matches
    } = React__namespace.useContext(RouteContext);
    let {
      pathname: locationPathname
    } = useLocation();
    let routePathnamesJson = JSON.stringify(router.UNSAFE_getResolveToMatches(matches, future.v7_relativeSplatPath));
    let activeRef = React__namespace.useRef(false);
    useIsomorphicLayoutEffect(() => {
      activeRef.current = true;
    });
    let navigate = React__namespace.useCallback(function (to, options) {
      if (options === void 0) {
        options = {};
      }
      router.UNSAFE_warning(activeRef.current, navigateEffectWarning) ;

      // Short circuit here since if this happens on first render the navigate
      // is useless because we haven't wired up our history listener yet
      if (!activeRef.current) return;
      if (typeof to === "number") {
        navigator.go(to);
        return;
      }
      let path = router.resolveTo(to, JSON.parse(routePathnamesJson), locationPathname, options.relative === "path");

      // If we're operating within a basename, prepend it to the pathname prior
      // to handing off to history (but only if we're not in a data router,
      // otherwise it'll prepend the basename inside of the router).
      // If this is a root navigation, then we navigate to the raw basename
      // which allows the basename to have full control over the presence of a
      // trailing slash on root links
      if (dataRouterContext == null && basename !== "/") {
        path.pathname = path.pathname === "/" ? basename : router.joinPaths([basename, path.pathname]);
      }
      (!!options.replace ? navigator.replace : navigator.push)(path, options.state, options);
    }, [basename, navigator, routePathnamesJson, locationPathname, dataRouterContext]);
    return navigate;
  }
  const OutletContext = /*#__PURE__*/React__namespace.createContext(null);

  /**
   * Returns the context (if provided) for the child route at this level of the route
   * hierarchy.
   * @see https://reactrouter.com/hooks/use-outlet-context
   */
  function useOutletContext() {
    return React__namespace.useContext(OutletContext);
  }

  /**
   * Returns the element for the child route at this level of the route
   * hierarchy. Used internally by `<Outlet>` to render child routes.
   *
   * @see https://reactrouter.com/hooks/use-outlet
   */
  function useOutlet(context) {
    let outlet = React__namespace.useContext(RouteContext).outlet;
    if (outlet) {
      return /*#__PURE__*/React__namespace.createElement(OutletContext.Provider, {
        value: context
      }, outlet);
    }
    return outlet;
  }

  /**
   * Returns an object of key/value pairs of the dynamic params from the current
   * URL that were matched by the route path.
   *
   * @see https://reactrouter.com/hooks/use-params
   */
  function useParams() {
    let {
      matches
    } = React__namespace.useContext(RouteContext);
    let routeMatch = matches[matches.length - 1];
    return routeMatch ? routeMatch.params : {};
  }

  /**
   * Resolves the pathname of the given `to` value against the current location.
   *
   * @see https://reactrouter.com/hooks/use-resolved-path
   */
  function useResolvedPath(to, _temp2) {
    let {
      relative
    } = _temp2 === void 0 ? {} : _temp2;
    let {
      future
    } = React__namespace.useContext(NavigationContext);
    let {
      matches
    } = React__namespace.useContext(RouteContext);
    let {
      pathname: locationPathname
    } = useLocation();
    let routePathnamesJson = JSON.stringify(router.UNSAFE_getResolveToMatches(matches, future.v7_relativeSplatPath));
    return React__namespace.useMemo(() => router.resolveTo(to, JSON.parse(routePathnamesJson), locationPathname, relative === "path"), [to, routePathnamesJson, locationPathname, relative]);
  }

  /**
   * Returns the element of the route that matched the current location, prepared
   * with the correct context to render the remainder of the route tree. Route
   * elements in the tree must render an `<Outlet>` to render their child route's
   * element.
   *
   * @see https://reactrouter.com/hooks/use-routes
   */
  function useRoutes(routes, locationArg) {
    return useRoutesImpl(routes, locationArg);
  }

  // Internal implementation with accept optional param for RouterProvider usage
  function useRoutesImpl(routes, locationArg, dataRouterState, future) {
    !useInRouterContext() ? router.UNSAFE_invariant(false, // TODO: This error is probably because they somehow have 2 versions of the
    // router loaded. We can help them understand how to avoid that.
    "useRoutes() may be used only in the context of a <Router> component.")  : void 0;
    let {
      navigator
    } = React__namespace.useContext(NavigationContext);
    let {
      matches: parentMatches
    } = React__namespace.useContext(RouteContext);
    let routeMatch = parentMatches[parentMatches.length - 1];
    let parentParams = routeMatch ? routeMatch.params : {};
    let parentPathname = routeMatch ? routeMatch.pathname : "/";
    let parentPathnameBase = routeMatch ? routeMatch.pathnameBase : "/";
    let parentRoute = routeMatch && routeMatch.route;
    {
      // You won't get a warning about 2 different <Routes> under a <Route>
      // without a trailing *, but this is a best-effort warning anyway since we
      // cannot even give the warning unless they land at the parent route.
      //
      // Example:
      //
      // <Routes>
      //   {/* This route path MUST end with /* because otherwise
      //       it will never match /blog/post/123 */}
      //   <Route path="blog" element={<Blog />} />
      //   <Route path="blog/feed" element={<BlogFeed />} />
      // </Routes>
      //
      // function Blog() {
      //   return (
      //     <Routes>
      //       <Route path="post/:id" element={<Post />} />
      //     </Routes>
      //   );
      // }
      let parentPath = parentRoute && parentRoute.path || "";
      warningOnce(parentPathname, !parentRoute || parentPath.endsWith("*"), "You rendered descendant <Routes> (or called `useRoutes()`) at " + ("\"" + parentPathname + "\" (under <Route path=\"" + parentPath + "\">) but the ") + "parent route path has no trailing \"*\". This means if you navigate " + "deeper, the parent won't match anymore and therefore the child " + "routes will never render.\n\n" + ("Please change the parent <Route path=\"" + parentPath + "\"> to <Route ") + ("path=\"" + (parentPath === "/" ? "*" : parentPath + "/*") + "\">."));
    }
    let locationFromContext = useLocation();
    let location;
    if (locationArg) {
      var _parsedLocationArg$pa;
      let parsedLocationArg = typeof locationArg === "string" ? router.parsePath(locationArg) : locationArg;
      !(parentPathnameBase === "/" || ((_parsedLocationArg$pa = parsedLocationArg.pathname) == null ? void 0 : _parsedLocationArg$pa.startsWith(parentPathnameBase))) ? router.UNSAFE_invariant(false, "When overriding the location using `<Routes location>` or `useRoutes(routes, location)`, " + "the location pathname must begin with the portion of the URL pathname that was " + ("matched by all parent routes. The current pathname base is \"" + parentPathnameBase + "\" ") + ("but pathname \"" + parsedLocationArg.pathname + "\" was given in the `location` prop."))  : void 0;
      location = parsedLocationArg;
    } else {
      location = locationFromContext;
    }
    let pathname = location.pathname || "/";
    let remainingPathname = parentPathnameBase === "/" ? pathname : pathname.slice(parentPathnameBase.length) || "/";
    let matches = router.matchRoutes(routes, {
      pathname: remainingPathname
    });
    {
      router.UNSAFE_warning(parentRoute || matches != null, "No routes matched location \"" + location.pathname + location.search + location.hash + "\" ") ;
      router.UNSAFE_warning(matches == null || matches[matches.length - 1].route.element !== undefined || matches[matches.length - 1].route.Component !== undefined || matches[matches.length - 1].route.lazy !== undefined, "Matched leaf route at location \"" + location.pathname + location.search + location.hash + "\" " + "does not have an element or Component. This means it will render an <Outlet /> with a " + "null value by default resulting in an \"empty\" page.") ;
    }
    let renderedMatches = _renderMatches(matches && matches.map(match => Object.assign({}, match, {
      params: Object.assign({}, parentParams, match.params),
      pathname: router.joinPaths([parentPathnameBase,
      // Re-encode pathnames that were decoded inside matchRoutes
      navigator.encodeLocation ? navigator.encodeLocation(match.pathname).pathname : match.pathname]),
      pathnameBase: match.pathnameBase === "/" ? parentPathnameBase : router.joinPaths([parentPathnameBase,
      // Re-encode pathnames that were decoded inside matchRoutes
      navigator.encodeLocation ? navigator.encodeLocation(match.pathnameBase).pathname : match.pathnameBase])
    })), parentMatches, dataRouterState, future);

    // When a user passes in a `locationArg`, the associated routes need to
    // be wrapped in a new `LocationContext.Provider` in order for `useLocation`
    // to use the scoped location instead of the global location.
    if (locationArg && renderedMatches) {
      return /*#__PURE__*/React__namespace.createElement(LocationContext.Provider, {
        value: {
          location: _extends({
            pathname: "/",
            search: "",
            hash: "",
            state: null,
            key: "default"
          }, location),
          navigationType: router.Action.Pop
        }
      }, renderedMatches);
    }
    return renderedMatches;
  }
  function DefaultErrorComponent() {
    let error = useRouteError();
    let message = router.isRouteErrorResponse(error) ? error.status + " " + error.statusText : error instanceof Error ? error.message : JSON.stringify(error);
    let stack = error instanceof Error ? error.stack : null;
    let lightgrey = "rgba(200,200,200, 0.5)";
    let preStyles = {
      padding: "0.5rem",
      backgroundColor: lightgrey
    };
    let codeStyles = {
      padding: "2px 4px",
      backgroundColor: lightgrey
    };
    let devInfo = null;
    {
      console.error("Error handled by React Router default ErrorBoundary:", error);
      devInfo = /*#__PURE__*/React__namespace.createElement(React__namespace.Fragment, null, /*#__PURE__*/React__namespace.createElement("p", null, "\uD83D\uDCBF Hey developer \uD83D\uDC4B"), /*#__PURE__*/React__namespace.createElement("p", null, "You can provide a way better UX than this when your app throws errors by providing your own ", /*#__PURE__*/React__namespace.createElement("code", {
        style: codeStyles
      }, "ErrorBoundary"), " or", " ", /*#__PURE__*/React__namespace.createElement("code", {
        style: codeStyles
      }, "errorElement"), " prop on your route."));
    }
    return /*#__PURE__*/React__namespace.createElement(React__namespace.Fragment, null, /*#__PURE__*/React__namespace.createElement("h2", null, "Unexpected Application Error!"), /*#__PURE__*/React__namespace.createElement("h3", {
      style: {
        fontStyle: "italic"
      }
    }, message), stack ? /*#__PURE__*/React__namespace.createElement("pre", {
      style: preStyles
    }, stack) : null, devInfo);
  }
  const defaultErrorElement = /*#__PURE__*/React__namespace.createElement(DefaultErrorComponent, null);
  class RenderErrorBoundary extends React__namespace.Component {
    constructor(props) {
      super(props);
      this.state = {
        location: props.location,
        revalidation: props.revalidation,
        error: props.error
      };
    }
    static getDerivedStateFromError(error) {
      return {
        error: error
      };
    }
    static getDerivedStateFromProps(props, state) {
      // When we get into an error state, the user will likely click "back" to the
      // previous page that didn't have an error. Because this wraps the entire
      // application, that will have no effect--the error page continues to display.
      // This gives us a mechanism to recover from the error when the location changes.
      //
      // Whether we're in an error state or not, we update the location in state
      // so that when we are in an error state, it gets reset when a new location
      // comes in and the user recovers from the error.
      if (state.location !== props.location || state.revalidation !== "idle" && props.revalidation === "idle") {
        return {
          error: props.error,
          location: props.location,
          revalidation: props.revalidation
        };
      }

      // If we're not changing locations, preserve the location but still surface
      // any new errors that may come through. We retain the existing error, we do
      // this because the error provided from the app state may be cleared without
      // the location changing.
      return {
        error: props.error !== undefined ? props.error : state.error,
        location: state.location,
        revalidation: props.revalidation || state.revalidation
      };
    }
    componentDidCatch(error, errorInfo) {
      console.error("React Router caught the following error during render", error, errorInfo);
    }
    render() {
      return this.state.error !== undefined ? /*#__PURE__*/React__namespace.createElement(RouteContext.Provider, {
        value: this.props.routeContext
      }, /*#__PURE__*/React__namespace.createElement(RouteErrorContext.Provider, {
        value: this.state.error,
        children: this.props.component
      })) : this.props.children;
    }
  }
  function RenderedRoute(_ref) {
    let {
      routeContext,
      match,
      children
    } = _ref;
    let dataRouterContext = React__namespace.useContext(DataRouterContext);

    // Track how deep we got in our render pass to emulate SSR componentDidCatch
    // in a DataStaticRouter
    if (dataRouterContext && dataRouterContext.static && dataRouterContext.staticContext && (match.route.errorElement || match.route.ErrorBoundary)) {
      dataRouterContext.staticContext._deepestRenderedBoundaryId = match.route.id;
    }
    return /*#__PURE__*/React__namespace.createElement(RouteContext.Provider, {
      value: routeContext
    }, children);
  }
  function _renderMatches(matches, parentMatches, dataRouterState, future) {
    var _dataRouterState2;
    if (parentMatches === void 0) {
      parentMatches = [];
    }
    if (dataRouterState === void 0) {
      dataRouterState = null;
    }
    if (future === void 0) {
      future = null;
    }
    if (matches == null) {
      var _dataRouterState;
      if ((_dataRouterState = dataRouterState) != null && _dataRouterState.errors) {
        // Don't bail if we have data router errors so we can render them in the
        // boundary.  Use the pre-matched (or shimmed) matches
        matches = dataRouterState.matches;
      } else {
        return null;
      }
    }
    let renderedMatches = matches;

    // If we have data errors, trim matches to the highest error boundary
    let errors = (_dataRouterState2 = dataRouterState) == null ? void 0 : _dataRouterState2.errors;
    if (errors != null) {
      let errorIndex = renderedMatches.findIndex(m => m.route.id && (errors == null ? void 0 : errors[m.route.id]));
      !(errorIndex >= 0) ? router.UNSAFE_invariant(false, "Could not find a matching route for errors on route IDs: " + Object.keys(errors).join(","))  : void 0;
      renderedMatches = renderedMatches.slice(0, Math.min(renderedMatches.length, errorIndex + 1));
    }

    // If we're in a partial hydration mode, detect if we need to render down to
    // a given HydrateFallback while we load the rest of the hydration data
    let renderFallback = false;
    let fallbackIndex = -1;
    if (dataRouterState && future && future.v7_partialHydration) {
      for (let i = 0; i < renderedMatches.length; i++) {
        let match = renderedMatches[i];
        // Track the deepest fallback up until the first route without data
        if (match.route.HydrateFallback || match.route.hydrateFallbackElement) {
          fallbackIndex = i;
        }
        if (match.route.id) {
          let {
            loaderData,
            errors
          } = dataRouterState;
          let needsToRunLoader = match.route.loader && loaderData[match.route.id] === undefined && (!errors || errors[match.route.id] === undefined);
          if (match.route.lazy || needsToRunLoader) {
            // We found the first route that's not ready to render (waiting on
            // lazy, or has a loader that hasn't run yet).  Flag that we need to
            // render a fallback and render up until the appropriate fallback
            renderFallback = true;
            if (fallbackIndex >= 0) {
              renderedMatches = renderedMatches.slice(0, fallbackIndex + 1);
            } else {
              renderedMatches = [renderedMatches[0]];
            }
            break;
          }
        }
      }
    }
    return renderedMatches.reduceRight((outlet, match, index) => {
      // Only data routers handle errors/fallbacks
      let error;
      let shouldRenderHydrateFallback = false;
      let errorElement = null;
      let hydrateFallbackElement = null;
      if (dataRouterState) {
        error = errors && match.route.id ? errors[match.route.id] : undefined;
        errorElement = match.route.errorElement || defaultErrorElement;
        if (renderFallback) {
          if (fallbackIndex < 0 && index === 0) {
            warningOnce("route-fallback", false, "No `HydrateFallback` element provided to render during initial hydration");
            shouldRenderHydrateFallback = true;
            hydrateFallbackElement = null;
          } else if (fallbackIndex === index) {
            shouldRenderHydrateFallback = true;
            hydrateFallbackElement = match.route.hydrateFallbackElement || null;
          }
        }
      }
      let matches = parentMatches.concat(renderedMatches.slice(0, index + 1));
      let getChildren = () => {
        let children;
        if (error) {
          children = errorElement;
        } else if (shouldRenderHydrateFallback) {
          children = hydrateFallbackElement;
        } else if (match.route.Component) {
          // Note: This is a de-optimized path since React won't re-use the
          // ReactElement since it's identity changes with each new
          // React.createElement call.  We keep this so folks can use
          // `<Route Component={...}>` in `<Routes>` but generally `Component`
          // usage is only advised in `RouterProvider` when we can convert it to
          // `element` ahead of time.
          children = /*#__PURE__*/React__namespace.createElement(match.route.Component, null);
        } else if (match.route.element) {
          children = match.route.element;
        } else {
          children = outlet;
        }
        return /*#__PURE__*/React__namespace.createElement(RenderedRoute, {
          match: match,
          routeContext: {
            outlet,
            matches,
            isDataRoute: dataRouterState != null
          },
          children: children
        });
      };
      // Only wrap in an error boundary within data router usages when we have an
      // ErrorBoundary/errorElement on this route.  Otherwise let it bubble up to
      // an ancestor ErrorBoundary/errorElement
      return dataRouterState && (match.route.ErrorBoundary || match.route.errorElement || index === 0) ? /*#__PURE__*/React__namespace.createElement(RenderErrorBoundary, {
        location: dataRouterState.location,
        revalidation: dataRouterState.revalidation,
        component: errorElement,
        error: error,
        children: getChildren(),
        routeContext: {
          outlet: null,
          matches,
          isDataRoute: true
        }
      }) : getChildren();
    }, null);
  }
  var DataRouterHook = /*#__PURE__*/function (DataRouterHook) {
    DataRouterHook["UseBlocker"] = "useBlocker";
    DataRouterHook["UseRevalidator"] = "useRevalidator";
    DataRouterHook["UseNavigateStable"] = "useNavigate";
    return DataRouterHook;
  }(DataRouterHook || {});
  var DataRouterStateHook = /*#__PURE__*/function (DataRouterStateHook) {
    DataRouterStateHook["UseBlocker"] = "useBlocker";
    DataRouterStateHook["UseLoaderData"] = "useLoaderData";
    DataRouterStateHook["UseActionData"] = "useActionData";
    DataRouterStateHook["UseRouteError"] = "useRouteError";
    DataRouterStateHook["UseNavigation"] = "useNavigation";
    DataRouterStateHook["UseRouteLoaderData"] = "useRouteLoaderData";
    DataRouterStateHook["UseMatches"] = "useMatches";
    DataRouterStateHook["UseRevalidator"] = "useRevalidator";
    DataRouterStateHook["UseNavigateStable"] = "useNavigate";
    DataRouterStateHook["UseRouteId"] = "useRouteId";
    return DataRouterStateHook;
  }(DataRouterStateHook || {});
  function getDataRouterConsoleError(hookName) {
    return hookName + " must be used within a data router.  See https://reactrouter.com/routers/picking-a-router.";
  }
  function useDataRouterContext(hookName) {
    let ctx = React__namespace.useContext(DataRouterContext);
    !ctx ? router.UNSAFE_invariant(false, getDataRouterConsoleError(hookName))  : void 0;
    return ctx;
  }
  function useDataRouterState(hookName) {
    let state = React__namespace.useContext(DataRouterStateContext);
    !state ? router.UNSAFE_invariant(false, getDataRouterConsoleError(hookName))  : void 0;
    return state;
  }
  function useRouteContext(hookName) {
    let route = React__namespace.useContext(RouteContext);
    !route ? router.UNSAFE_invariant(false, getDataRouterConsoleError(hookName))  : void 0;
    return route;
  }

  // Internal version with hookName-aware debugging
  function useCurrentRouteId(hookName) {
    let route = useRouteContext(hookName);
    let thisRoute = route.matches[route.matches.length - 1];
    !thisRoute.route.id ? router.UNSAFE_invariant(false, hookName + " can only be used on routes that contain a unique \"id\"")  : void 0;
    return thisRoute.route.id;
  }

  /**
   * Returns the ID for the nearest contextual route
   */
  function useRouteId() {
    return useCurrentRouteId(DataRouterStateHook.UseRouteId);
  }

  /**
   * Returns the current navigation, defaulting to an "idle" navigation when
   * no navigation is in progress
   */
  function useNavigation() {
    let state = useDataRouterState(DataRouterStateHook.UseNavigation);
    return state.navigation;
  }

  /**
   * Returns a revalidate function for manually triggering revalidation, as well
   * as the current state of any manual revalidations
   */
  function useRevalidator() {
    let dataRouterContext = useDataRouterContext(DataRouterHook.UseRevalidator);
    let state = useDataRouterState(DataRouterStateHook.UseRevalidator);
    return React__namespace.useMemo(() => ({
      revalidate: dataRouterContext.router.revalidate,
      state: state.revalidation
    }), [dataRouterContext.router.revalidate, state.revalidation]);
  }

  /**
   * Returns the active route matches, useful for accessing loaderData for
   * parent/child routes or the route "handle" property
   */
  function useMatches() {
    let {
      matches,
      loaderData
    } = useDataRouterState(DataRouterStateHook.UseMatches);
    return React__namespace.useMemo(() => matches.map(m => router.UNSAFE_convertRouteMatchToUiMatch(m, loaderData)), [matches, loaderData]);
  }

  /**
   * Returns the loader data for the nearest ancestor Route loader
   */
  function useLoaderData() {
    let state = useDataRouterState(DataRouterStateHook.UseLoaderData);
    let routeId = useCurrentRouteId(DataRouterStateHook.UseLoaderData);
    if (state.errors && state.errors[routeId] != null) {
      console.error("You cannot `useLoaderData` in an errorElement (routeId: " + routeId + ")");
      return undefined;
    }
    return state.loaderData[routeId];
  }

  /**
   * Returns the loaderData for the given routeId
   */
  function useRouteLoaderData(routeId) {
    let state = useDataRouterState(DataRouterStateHook.UseRouteLoaderData);
    return state.loaderData[routeId];
  }

  /**
   * Returns the action data for the nearest ancestor Route action
   */
  function useActionData() {
    let state = useDataRouterState(DataRouterStateHook.UseActionData);
    let routeId = useCurrentRouteId(DataRouterStateHook.UseLoaderData);
    return state.actionData ? state.actionData[routeId] : undefined;
  }

  /**
   * Returns the nearest ancestor Route error, which could be a loader/action
   * error or a render error.  This is intended to be called from your
   * ErrorBoundary/errorElement to display a proper error message.
   */
  function useRouteError() {
    var _state$errors;
    let error = React__namespace.useContext(RouteErrorContext);
    let state = useDataRouterState(DataRouterStateHook.UseRouteError);
    let routeId = useCurrentRouteId(DataRouterStateHook.UseRouteError);

    // If this was a render error, we put it in a RouteError context inside
    // of RenderErrorBoundary
    if (error !== undefined) {
      return error;
    }

    // Otherwise look for errors from our data router state
    return (_state$errors = state.errors) == null ? void 0 : _state$errors[routeId];
  }

  /**
   * Returns the happy-path data from the nearest ancestor `<Await />` value
   */
  function useAsyncValue() {
    let value = React__namespace.useContext(AwaitContext);
    return value == null ? void 0 : value._data;
  }

  /**
   * Returns the error from the nearest ancestor `<Await />` value
   */
  function useAsyncError() {
    let value = React__namespace.useContext(AwaitContext);
    return value == null ? void 0 : value._error;
  }
  let blockerId = 0;

  /**
   * Allow the application to block navigations within the SPA and present the
   * user a confirmation dialog to confirm the navigation.  Mostly used to avoid
   * using half-filled form data.  This does not handle hard-reloads or
   * cross-origin navigations.
   */
  function useBlocker(shouldBlock) {
    let {
      router: router$1,
      basename
    } = useDataRouterContext(DataRouterHook.UseBlocker);
    let state = useDataRouterState(DataRouterStateHook.UseBlocker);
    let [blockerKey, setBlockerKey] = React__namespace.useState("");
    let blockerFunction = React__namespace.useCallback(arg => {
      if (typeof shouldBlock !== "function") {
        return !!shouldBlock;
      }
      if (basename === "/") {
        return shouldBlock(arg);
      }

      // If they provided us a function and we've got an active basename, strip
      // it from the locations we expose to the user to match the behavior of
      // useLocation
      let {
        currentLocation,
        nextLocation,
        historyAction
      } = arg;
      return shouldBlock({
        currentLocation: _extends({}, currentLocation, {
          pathname: router.stripBasename(currentLocation.pathname, basename) || currentLocation.pathname
        }),
        nextLocation: _extends({}, nextLocation, {
          pathname: router.stripBasename(nextLocation.pathname, basename) || nextLocation.pathname
        }),
        historyAction
      });
    }, [basename, shouldBlock]);

    // This effect is in charge of blocker key assignment and deletion (which is
    // tightly coupled to the key)
    React__namespace.useEffect(() => {
      let key = String(++blockerId);
      setBlockerKey(key);
      return () => router$1.deleteBlocker(key);
    }, [router$1]);

    // This effect handles assigning the blockerFunction.  This is to handle
    // unstable blocker function identities, and happens only after the prior
    // effect so we don't get an orphaned blockerFunction in the router with a
    // key of "".  Until then we just have the IDLE_BLOCKER.
    React__namespace.useEffect(() => {
      if (blockerKey !== "") {
        router$1.getBlocker(blockerKey, blockerFunction);
      }
    }, [router$1, blockerKey, blockerFunction]);

    // Prefer the blocker from `state` not `router.state` since DataRouterContext
    // is memoized so this ensures we update on blocker state updates
    return blockerKey && state.blockers.has(blockerKey) ? state.blockers.get(blockerKey) : router.IDLE_BLOCKER;
  }

  /**
   * Stable version of useNavigate that is used when we are in the context of
   * a RouterProvider.
   */
  function useNavigateStable() {
    let {
      router: router$1
    } = useDataRouterContext(DataRouterHook.UseNavigateStable);
    let id = useCurrentRouteId(DataRouterStateHook.UseNavigateStable);
    let activeRef = React__namespace.useRef(false);
    useIsomorphicLayoutEffect(() => {
      activeRef.current = true;
    });
    let navigate = React__namespace.useCallback(function (to, options) {
      if (options === void 0) {
        options = {};
      }
      router.UNSAFE_warning(activeRef.current, navigateEffectWarning) ;

      // Short circuit here since if this happens on first render the navigate
      // is useless because we haven't wired up our router subscriber yet
      if (!activeRef.current) return;
      if (typeof to === "number") {
        router$1.navigate(to);
      } else {
        router$1.navigate(to, _extends({
          fromRouteId: id
        }, options));
      }
    }, [router$1, id]);
    return navigate;
  }
  const alreadyWarned = {};
  function warningOnce(key, cond, message) {
    if (!cond && !alreadyWarned[key]) {
      alreadyWarned[key] = true;
      router.UNSAFE_warning(false, message) ;
    }
  }

  /**
    Webpack + React 17 fails to compile on any of the following because webpack
    complains that `startTransition` doesn't exist in `React`:
    * import { startTransition } from "react"
    * import * as React from from "react";
      "startTransition" in React ? React.startTransition(() => setState()) : setState()
    * import * as React from from "react";
      "startTransition" in React ? React["startTransition"](() => setState()) : setState()

    Moving it to a constant such as the following solves the Webpack/React 17 issue:
    * import * as React from from "react";
      const START_TRANSITION = "startTransition";
      START_TRANSITION in React ? React[START_TRANSITION](() => setState()) : setState()

    However, that introduces webpack/terser minification issues in production builds
    in React 18 where minification/obfuscation ends up removing the call of
    React.startTransition entirely from the first half of the ternary.  Grabbing
    this exported reference once up front resolves that issue.

    See https://github.com/remix-run/react-router/issues/10579
  */
  const START_TRANSITION = "startTransition";
  const startTransitionImpl = React__namespace[START_TRANSITION];

  /**
   * Given a Remix Router instance, render the appropriate UI
   */
  function RouterProvider(_ref) {
    let {
      fallbackElement,
      router: router$1,
      future
    } = _ref;
    let [state, setStateImpl] = React__namespace.useState(router$1.state);
    let {
      v7_startTransition
    } = future || {};
    let setState = React__namespace.useCallback(newState => {
      if (v7_startTransition && startTransitionImpl) {
        startTransitionImpl(() => setStateImpl(newState));
      } else {
        setStateImpl(newState);
      }
    }, [setStateImpl, v7_startTransition]);

    // Need to use a layout effect here so we are subscribed early enough to
    // pick up on any render-driven redirects/navigations (useEffect/<Navigate>)
    React__namespace.useLayoutEffect(() => router$1.subscribe(setState), [router$1, setState]);
    React__namespace.useEffect(() => {
      router.UNSAFE_warning(fallbackElement == null || !router$1.future.v7_partialHydration, "`<RouterProvider fallbackElement>` is deprecated when using " + "`v7_partialHydration`, use a `HydrateFallback` component instead") ;
      // Only log this once on initial mount
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    let navigator = React__namespace.useMemo(() => {
      return {
        createHref: router$1.createHref,
        encodeLocation: router$1.encodeLocation,
        go: n => router$1.navigate(n),
        push: (to, state, opts) => router$1.navigate(to, {
          state,
          preventScrollReset: opts == null ? void 0 : opts.preventScrollReset
        }),
        replace: (to, state, opts) => router$1.navigate(to, {
          replace: true,
          state,
          preventScrollReset: opts == null ? void 0 : opts.preventScrollReset
        })
      };
    }, [router$1]);
    let basename = router$1.basename || "/";
    let dataRouterContext = React__namespace.useMemo(() => ({
      router: router$1,
      navigator,
      static: false,
      basename
    }), [router$1, navigator, basename]);

    // The fragment and {null} here are important!  We need them to keep React 18's
    // useId happy when we are server-rendering since we may have a <script> here
    // containing the hydrated server-side staticContext (from StaticRouterProvider).
    // useId relies on the component tree structure to generate deterministic id's
    // so we need to ensure it remains the same on the client even though
    // we don't need the <script> tag
    return /*#__PURE__*/React__namespace.createElement(React__namespace.Fragment, null, /*#__PURE__*/React__namespace.createElement(DataRouterContext.Provider, {
      value: dataRouterContext
    }, /*#__PURE__*/React__namespace.createElement(DataRouterStateContext.Provider, {
      value: state
    }, /*#__PURE__*/React__namespace.createElement(Router, {
      basename: basename,
      location: state.location,
      navigationType: state.historyAction,
      navigator: navigator,
      future: {
        v7_relativeSplatPath: router$1.future.v7_relativeSplatPath
      }
    }, state.initialized || router$1.future.v7_partialHydration ? /*#__PURE__*/React__namespace.createElement(DataRoutes, {
      routes: router$1.routes,
      future: router$1.future,
      state: state
    }) : fallbackElement))), null);
  }
  function DataRoutes(_ref2) {
    let {
      routes,
      future,
      state
    } = _ref2;
    return useRoutesImpl(routes, undefined, state, future);
  }
  /**
   * A `<Router>` that stores all entries in memory.
   *
   * @see https://reactrouter.com/router-components/memory-router
   */
  function MemoryRouter(_ref3) {
    let {
      basename,
      children,
      initialEntries,
      initialIndex,
      future
    } = _ref3;
    let historyRef = React__namespace.useRef();
    if (historyRef.current == null) {
      historyRef.current = router.createMemoryHistory({
        initialEntries,
        initialIndex,
        v5Compat: true
      });
    }
    let history = historyRef.current;
    let [state, setStateImpl] = React__namespace.useState({
      action: history.action,
      location: history.location
    });
    let {
      v7_startTransition
    } = future || {};
    let setState = React__namespace.useCallback(newState => {
      v7_startTransition && startTransitionImpl ? startTransitionImpl(() => setStateImpl(newState)) : setStateImpl(newState);
    }, [setStateImpl, v7_startTransition]);
    React__namespace.useLayoutEffect(() => history.listen(setState), [history, setState]);
    return /*#__PURE__*/React__namespace.createElement(Router, {
      basename: basename,
      children: children,
      location: state.location,
      navigationType: state.action,
      navigator: history,
      future: future
    });
  }
  /**
   * Changes the current location.
   *
   * Note: This API is mostly useful in React.Component subclasses that are not
   * able to use hooks. In functional components, we recommend you use the
   * `useNavigate` hook instead.
   *
   * @see https://reactrouter.com/components/navigate
   */
  function Navigate(_ref4) {
    let {
      to,
      replace,
      state,
      relative
    } = _ref4;
    !useInRouterContext() ? router.UNSAFE_invariant(false, // TODO: This error is probably because they somehow have 2 versions of
    // the router loaded. We can help them understand how to avoid that.
    "<Navigate> may be used only in the context of a <Router> component.")  : void 0;
    let {
      future,
      static: isStatic
    } = React__namespace.useContext(NavigationContext);
    router.UNSAFE_warning(!isStatic, "<Navigate> must not be used on the initial render in a <StaticRouter>. " + "This is a no-op, but you should modify your code so the <Navigate> is " + "only ever rendered in response to some user interaction or state change.") ;
    let {
      matches
    } = React__namespace.useContext(RouteContext);
    let {
      pathname: locationPathname
    } = useLocation();
    let navigate = useNavigate();

    // Resolve the path outside of the effect so that when effects run twice in
    // StrictMode they navigate to the same place
    let path = router.resolveTo(to, router.UNSAFE_getResolveToMatches(matches, future.v7_relativeSplatPath), locationPathname, relative === "path");
    let jsonPath = JSON.stringify(path);
    React__namespace.useEffect(() => navigate(JSON.parse(jsonPath), {
      replace,
      state,
      relative
    }), [navigate, jsonPath, relative, replace, state]);
    return null;
  }
  /**
   * Renders the child route's element, if there is one.
   *
   * @see https://reactrouter.com/components/outlet
   */
  function Outlet(props) {
    return useOutlet(props.context);
  }
  /**
   * Declares an element that should be rendered at a certain URL path.
   *
   * @see https://reactrouter.com/components/route
   */
  function Route(_props) {
    router.UNSAFE_invariant(false, "A <Route> is only ever to be used as the child of <Routes> element, " + "never rendered directly. Please wrap your <Route> in a <Routes>.")  ;
  }
  /**
   * Provides location context for the rest of the app.
   *
   * Note: You usually won't render a `<Router>` directly. Instead, you'll render a
   * router that is more specific to your environment such as a `<BrowserRouter>`
   * in web browsers or a `<StaticRouter>` for server rendering.
   *
   * @see https://reactrouter.com/router-components/router
   */
  function Router(_ref5) {
    let {
      basename: basenameProp = "/",
      children = null,
      location: locationProp,
      navigationType = router.Action.Pop,
      navigator,
      static: staticProp = false,
      future
    } = _ref5;
    !!useInRouterContext() ? router.UNSAFE_invariant(false, "You cannot render a <Router> inside another <Router>." + " You should never have more than one in your app.")  : void 0;

    // Preserve trailing slashes on basename, so we can let the user control
    // the enforcement of trailing slashes throughout the app
    let basename = basenameProp.replace(/^\/*/, "/");
    let navigationContext = React__namespace.useMemo(() => ({
      basename,
      navigator,
      static: staticProp,
      future: _extends({
        v7_relativeSplatPath: false
      }, future)
    }), [basename, future, navigator, staticProp]);
    if (typeof locationProp === "string") {
      locationProp = router.parsePath(locationProp);
    }
    let {
      pathname = "/",
      search = "",
      hash = "",
      state = null,
      key = "default"
    } = locationProp;
    let locationContext = React__namespace.useMemo(() => {
      let trailingPathname = router.stripBasename(pathname, basename);
      if (trailingPathname == null) {
        return null;
      }
      return {
        location: {
          pathname: trailingPathname,
          search,
          hash,
          state,
          key
        },
        navigationType
      };
    }, [basename, pathname, search, hash, state, key, navigationType]);
    router.UNSAFE_warning(locationContext != null, "<Router basename=\"" + basename + "\"> is not able to match the URL " + ("\"" + pathname + search + hash + "\" because it does not start with the ") + "basename, so the <Router> won't render anything.") ;
    if (locationContext == null) {
      return null;
    }
    return /*#__PURE__*/React__namespace.createElement(NavigationContext.Provider, {
      value: navigationContext
    }, /*#__PURE__*/React__namespace.createElement(LocationContext.Provider, {
      children: children,
      value: locationContext
    }));
  }
  /**
   * A container for a nested tree of `<Route>` elements that renders the branch
   * that best matches the current location.
   *
   * @see https://reactrouter.com/components/routes
   */
  function Routes(_ref6) {
    let {
      children,
      location
    } = _ref6;
    return useRoutes(createRoutesFromChildren(children), location);
  }
  /**
   * Component to use for rendering lazily loaded data from returning defer()
   * in a loader function
   */
  function Await(_ref7) {
    let {
      children,
      errorElement,
      resolve
    } = _ref7;
    return /*#__PURE__*/React__namespace.createElement(AwaitErrorBoundary, {
      resolve: resolve,
      errorElement: errorElement
    }, /*#__PURE__*/React__namespace.createElement(ResolveAwait, null, children));
  }
  var AwaitRenderStatus = /*#__PURE__*/function (AwaitRenderStatus) {
    AwaitRenderStatus[AwaitRenderStatus["pending"] = 0] = "pending";
    AwaitRenderStatus[AwaitRenderStatus["success"] = 1] = "success";
    AwaitRenderStatus[AwaitRenderStatus["error"] = 2] = "error";
    return AwaitRenderStatus;
  }(AwaitRenderStatus || {});
  const neverSettledPromise = new Promise(() => {});
  class AwaitErrorBoundary extends React__namespace.Component {
    constructor(props) {
      super(props);
      this.state = {
        error: null
      };
    }
    static getDerivedStateFromError(error) {
      return {
        error
      };
    }
    componentDidCatch(error, errorInfo) {
      console.error("<Await> caught the following error during render", error, errorInfo);
    }
    render() {
      let {
        children,
        errorElement,
        resolve
      } = this.props;
      let promise = null;
      let status = AwaitRenderStatus.pending;
      if (!(resolve instanceof Promise)) {
        // Didn't get a promise - provide as a resolved promise
        status = AwaitRenderStatus.success;
        promise = Promise.resolve();
        Object.defineProperty(promise, "_tracked", {
          get: () => true
        });
        Object.defineProperty(promise, "_data", {
          get: () => resolve
        });
      } else if (this.state.error) {
        // Caught a render error, provide it as a rejected promise
        status = AwaitRenderStatus.error;
        let renderError = this.state.error;
        promise = Promise.reject().catch(() => {}); // Avoid unhandled rejection warnings
        Object.defineProperty(promise, "_tracked", {
          get: () => true
        });
        Object.defineProperty(promise, "_error", {
          get: () => renderError
        });
      } else if (resolve._tracked) {
        // Already tracked promise - check contents
        promise = resolve;
        status = promise._error !== undefined ? AwaitRenderStatus.error : promise._data !== undefined ? AwaitRenderStatus.success : AwaitRenderStatus.pending;
      } else {
        // Raw (untracked) promise - track it
        status = AwaitRenderStatus.pending;
        Object.defineProperty(resolve, "_tracked", {
          get: () => true
        });
        promise = resolve.then(data => Object.defineProperty(resolve, "_data", {
          get: () => data
        }), error => Object.defineProperty(resolve, "_error", {
          get: () => error
        }));
      }
      if (status === AwaitRenderStatus.error && promise._error instanceof router.AbortedDeferredError) {
        // Freeze the UI by throwing a never resolved promise
        throw neverSettledPromise;
      }
      if (status === AwaitRenderStatus.error && !errorElement) {
        // No errorElement, throw to the nearest route-level error boundary
        throw promise._error;
      }
      if (status === AwaitRenderStatus.error) {
        // Render via our errorElement
        return /*#__PURE__*/React__namespace.createElement(AwaitContext.Provider, {
          value: promise,
          children: errorElement
        });
      }
      if (status === AwaitRenderStatus.success) {
        // Render children with resolved value
        return /*#__PURE__*/React__namespace.createElement(AwaitContext.Provider, {
          value: promise,
          children: children
        });
      }

      // Throw to the suspense boundary
      throw promise;
    }
  }

  /**
   * @private
   * Indirection to leverage useAsyncValue for a render-prop API on `<Await>`
   */
  function ResolveAwait(_ref8) {
    let {
      children
    } = _ref8;
    let data = useAsyncValue();
    let toRender = typeof children === "function" ? children(data) : children;
    return /*#__PURE__*/React__namespace.createElement(React__namespace.Fragment, null, toRender);
  }

  ///////////////////////////////////////////////////////////////////////////////
  // UTILS
  ///////////////////////////////////////////////////////////////////////////////

  /**
   * Creates a route config from a React "children" object, which is usually
   * either a `<Route>` element or an array of them. Used internally by
   * `<Routes>` to create a route config from its children.
   *
   * @see https://reactrouter.com/utils/create-routes-from-children
   */
  function createRoutesFromChildren(children, parentPath) {
    if (parentPath === void 0) {
      parentPath = [];
    }
    let routes = [];
    React__namespace.Children.forEach(children, (element, index) => {
      if (! /*#__PURE__*/React__namespace.isValidElement(element)) {
        // Ignore non-elements. This allows people to more easily inline
        // conditionals in their route config.
        return;
      }
      let treePath = [...parentPath, index];
      if (element.type === React__namespace.Fragment) {
        // Transparently support React.Fragment and its children.
        routes.push.apply(routes, createRoutesFromChildren(element.props.children, treePath));
        return;
      }
      !(element.type === Route) ? router.UNSAFE_invariant(false, "[" + (typeof element.type === "string" ? element.type : element.type.name) + "] is not a <Route> component. All component children of <Routes> must be a <Route> or <React.Fragment>")  : void 0;
      !(!element.props.index || !element.props.children) ? router.UNSAFE_invariant(false, "An index route cannot have child routes.")  : void 0;
      let route = {
        id: element.props.id || treePath.join("-"),
        caseSensitive: element.props.caseSensitive,
        element: element.props.element,
        Component: element.props.Component,
        index: element.props.index,
        path: element.props.path,
        loader: element.props.loader,
        action: element.props.action,
        errorElement: element.props.errorElement,
        ErrorBoundary: element.props.ErrorBoundary,
        hasErrorBoundary: element.props.ErrorBoundary != null || element.props.errorElement != null,
        shouldRevalidate: element.props.shouldRevalidate,
        handle: element.props.handle,
        lazy: element.props.lazy
      };
      if (element.props.children) {
        route.children = createRoutesFromChildren(element.props.children, treePath);
      }
      routes.push(route);
    });
    return routes;
  }

  /**
   * Renders the result of `matchRoutes()` into a React element.
   */
  function renderMatches(matches) {
    return _renderMatches(matches);
  }

  function mapRouteProperties(route) {
    let updates = {
      // Note: this check also occurs in createRoutesFromChildren so update
      // there if you change this -- please and thank you!
      hasErrorBoundary: route.ErrorBoundary != null || route.errorElement != null
    };
    if (route.Component) {
      {
        if (route.element) {
          router.UNSAFE_warning(false, "You should not include both `Component` and `element` on your route - " + "`Component` will be used.") ;
        }
      }
      Object.assign(updates, {
        element: /*#__PURE__*/React__namespace.createElement(route.Component),
        Component: undefined
      });
    }
    if (route.HydrateFallback) {
      {
        if (route.hydrateFallbackElement) {
          router.UNSAFE_warning(false, "You should not include both `HydrateFallback` and `hydrateFallbackElement` on your route - " + "`HydrateFallback` will be used.") ;
        }
      }
      Object.assign(updates, {
        hydrateFallbackElement: /*#__PURE__*/React__namespace.createElement(route.HydrateFallback),
        HydrateFallback: undefined
      });
    }
    if (route.ErrorBoundary) {
      {
        if (route.errorElement) {
          router.UNSAFE_warning(false, "You should not include both `ErrorBoundary` and `errorElement` on your route - " + "`ErrorBoundary` will be used.") ;
        }
      }
      Object.assign(updates, {
        errorElement: /*#__PURE__*/React__namespace.createElement(route.ErrorBoundary),
        ErrorBoundary: undefined
      });
    }
    return updates;
  }
  function createMemoryRouter(routes, opts) {
    return router.createRouter({
      basename: opts == null ? void 0 : opts.basename,
      future: _extends({}, opts == null ? void 0 : opts.future, {
        v7_prependBasename: true
      }),
      history: router.createMemoryHistory({
        initialEntries: opts == null ? void 0 : opts.initialEntries,
        initialIndex: opts == null ? void 0 : opts.initialIndex
      }),
      hydrationData: opts == null ? void 0 : opts.hydrationData,
      routes,
      mapRouteProperties
    }).initialize();
  }

  Object.defineProperty(exports, 'AbortedDeferredError', {
    enumerable: true,
    get: function () { return router.AbortedDeferredError; }
  });
  Object.defineProperty(exports, 'NavigationType', {
    enumerable: true,
    get: function () { return router.Action; }
  });
  Object.defineProperty(exports, 'createPath', {
    enumerable: true,
    get: function () { return router.createPath; }
  });
  Object.defineProperty(exports, 'defer', {
    enumerable: true,
    get: function () { return router.defer; }
  });
  Object.defineProperty(exports, 'generatePath', {
    enumerable: true,
    get: function () { return router.generatePath; }
  });
  Object.defineProperty(exports, 'isRouteErrorResponse', {
    enumerable: true,
    get: function () { return router.isRouteErrorResponse; }
  });
  Object.defineProperty(exports, 'json', {
    enumerable: true,
    get: function () { return router.json; }
  });
  Object.defineProperty(exports, 'matchPath', {
    enumerable: true,
    get: function () { return router.matchPath; }
  });
  Object.defineProperty(exports, 'matchRoutes', {
    enumerable: true,
    get: function () { return router.matchRoutes; }
  });
  Object.defineProperty(exports, 'parsePath', {
    enumerable: true,
    get: function () { return router.parsePath; }
  });
  Object.defineProperty(exports, 'redirect', {
    enumerable: true,
    get: function () { return router.redirect; }
  });
  Object.defineProperty(exports, 'redirectDocument', {
    enumerable: true,
    get: function () { return router.redirectDocument; }
  });
  Object.defineProperty(exports, 'resolvePath', {
    enumerable: true,
    get: function () { return router.resolvePath; }
  });
  exports.Await = Await;
  exports.MemoryRouter = MemoryRouter;
  exports.Navigate = Navigate;
  exports.Outlet = Outlet;
  exports.Route = Route;
  exports.Router = Router;
  exports.RouterProvider = RouterProvider;
  exports.Routes = Routes;
  exports.UNSAFE_DataRouterContext = DataRouterContext;
  exports.UNSAFE_DataRouterStateContext = DataRouterStateContext;
  exports.UNSAFE_LocationContext = LocationContext;
  exports.UNSAFE_NavigationContext = NavigationContext;
  exports.UNSAFE_RouteContext = RouteContext;
  exports.UNSAFE_mapRouteProperties = mapRouteProperties;
  exports.UNSAFE_useRouteId = useRouteId;
  exports.UNSAFE_useRoutesImpl = useRoutesImpl;
  exports.createMemoryRouter = createMemoryRouter;
  exports.createRoutesFromChildren = createRoutesFromChildren;
  exports.createRoutesFromElements = createRoutesFromChildren;
  exports.renderMatches = renderMatches;
  exports.useActionData = useActionData;
  exports.useAsyncError = useAsyncError;
  exports.useAsyncValue = useAsyncValue;
  exports.useBlocker = useBlocker;
  exports.useHref = useHref;
  exports.useInRouterContext = useInRouterContext;
  exports.useLoaderData = useLoaderData;
  exports.useLocation = useLocation;
  exports.useMatch = useMatch;
  exports.useMatches = useMatches;
  exports.useNavigate = useNavigate;
  exports.useNavigation = useNavigation;
  exports.useNavigationType = useNavigationType;
  exports.useOutlet = useOutlet;
  exports.useOutletContext = useOutletContext;
  exports.useParams = useParams;
  exports.useResolvedPath = useResolvedPath;
  exports.useRevalidator = useRevalidator;
  exports.useRouteError = useRouteError;
  exports.useRouteLoaderData = useRouteLoaderData;
  exports.useRoutes = useRoutes;

  Object.defineProperty(exports, '__esModule', { value: true });

}));
//# sourceMappingURL=react-router.development.js.map
