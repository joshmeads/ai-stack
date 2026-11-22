// \0rolldown/runtime.js
var e = (e, t) => () => (t || (e((t = { exports: {} }).exports, t, t.exports), e = null), t.exports), t = /* @__PURE__ */ e(((e) => {
	function t(e, t) {
		var n = e.length;
		e.push(t);
		a: for (; 0 < n;) {
			var r = n - 1 >>> 1, a = e[r];
			if (0 < i(a, t)) e[r] = t, e[n] = a, n = r;
			else break a;
		}
	}
	function n(e) {
		return e.length === 0 ? null : e[0];
	}
	function r(e) {
		if (e.length === 0) return null;
		var t = e[0], n = e.pop();
		if (n !== t) {
			e[0] = n;
			a: for (var r = 0, a = e.length, o = a >>> 1; r < o;) {
				var s = 2 * (r + 1) - 1, c = e[s], l = s + 1, u = e[l];
				if (0 > i(c, n)) l < a && 0 > i(u, c) ? (e[r] = u, e[l] = n, r = l) : (e[r] = c, e[s] = n, r = s);
				else if (l < a && 0 > i(u, n)) e[r] = u, e[l] = n, r = l;
				else break a;
			}
		}
		return t;
	}
	function i(e, t) {
		var n = e.sortIndex - t.sortIndex;
		return n === 0 ? e.id - t.id : n;
	}
	if (e.unstable_now = void 0, typeof performance == "object" && typeof performance.now == "function") {
		var a = performance;
		e.unstable_now = function() {
			return a.now();
		};
	} else {
		var o = Date, s = o.now();
		e.unstable_now = function() {
			return o.now() - s;
		};
	}
	var c = [], l = [], u = 1, d = null, f = 3, p = !1, m = !1, h = !1, g = !1, _ = typeof setTimeout == "function" ? setTimeout : null, v = typeof clearTimeout == "function" ? clearTimeout : null, y = typeof setImmediate < "u" ? setImmediate : null;
	function b(e) {
		for (var i = n(l); i !== null;) {
			if (i.callback === null) r(l);
			else if (i.startTime <= e) r(l), i.sortIndex = i.expirationTime, t(c, i);
			else break;
			i = n(l);
		}
	}
	function x(e) {
		if (h = !1, b(e), !m) {
			if (n(c) !== null) m = !0, S || (S = !0, ne());
			else {
				var t = n(l);
				t !== null && E(x, t.startTime - e);
			}
		}
	}
	var S = !1, ee = -1, C = 5, w = -1;
	function te() {
		return g ? !0 : !(e.unstable_now() - w < C);
	}
	function T() {
		if (g = !1, S) {
			var t = e.unstable_now();
			w = t;
			var i = !0;
			try {
				a: {
					m = !1, h && (h = !1, v(ee), ee = -1), p = !0;
					var a = f;
					try {
						b: {
							for (b(t), d = n(c); d !== null && !(d.expirationTime > t && te());) {
								var o = d.callback;
								if (typeof o == "function") {
									d.callback = null, f = d.priorityLevel;
									var s = o(d.expirationTime <= t);
									if (t = e.unstable_now(), typeof s == "function") {
										d.callback = s, b(t), i = !0;
										break b;
									}
									d === n(c) && r(c), b(t);
								} else r(c);
								d = n(c);
							}
							if (d !== null) i = !0;
							else {
								var u = n(l);
								u !== null && E(x, u.startTime - t), i = !1;
							}
						}
						break a;
					} finally {
						d = null, f = a, p = !1;
					}
					i = void 0;
				}
			} finally {
				i ? ne() : S = !1;
			}
		}
	}
	var ne;
	if (typeof y == "function") ne = function() {
		y(T);
	};
	else if (typeof MessageChannel < "u") {
		var re = new MessageChannel(), ie = re.port2;
		re.port1.onmessage = T, ne = function() {
			ie.postMessage(null);
		};
	} else ne = function() {
		_(T, 0);
	};
	function E(t, n) {
		ee = _(function() {
			t(e.unstable_now());
		}, n);
	}
	e.unstable_IdlePriority = 5, e.unstable_ImmediatePriority = 1, e.unstable_LowPriority = 4, e.unstable_NormalPriority = 3, e.unstable_Profiling = null, e.unstable_UserBlockingPriority = 2, e.unstable_cancelCallback = function(e) {
		e.callback = null;
	}, e.unstable_forceFrameRate = function(e) {
		0 > e || 125 < e ? console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported") : C = 0 < e ? Math.floor(1e3 / e) : 5;
	}, e.unstable_getCurrentPriorityLevel = function() {
		return f;
	}, e.unstable_next = function(e) {
		switch (f) {
			case 1:
			case 2:
			case 3:
				var t = 3;
				break;
			default: t = f;
		}
		var n = f;
		f = t;
		try {
			return e();
		} finally {
			f = n;
		}
	}, e.unstable_requestPaint = function() {
		g = !0;
	}, e.unstable_runWithPriority = function(e, t) {
		switch (e) {
			case 1:
			case 2:
			case 3:
			case 4:
			case 5: break;
			default: e = 3;
		}
		var n = f;
		f = e;
		try {
			return t();
		} finally {
			f = n;
		}
	}, e.unstable_scheduleCallback = function(r, i, a) {
		var o = e.unstable_now();
		switch (typeof a == "object" && a ? (a = a.delay, a = typeof a == "number" && 0 < a ? o + a : o) : a = o, r) {
			case 1:
				var s = -1;
				break;
			case 2:
				s = 250;
				break;
			case 5:
				s = 1073741823;
				break;
			case 4:
				s = 1e4;
				break;
			default: s = 5e3;
		}
		return s = a + s, r = {
			id: u++,
			callback: i,
			priorityLevel: r,
			startTime: a,
			expirationTime: s,
			sortIndex: -1
		}, a > o ? (r.sortIndex = a, t(l, r), n(c) === null && r === n(l) && (h ? (v(ee), ee = -1) : h = !0, E(x, a - o))) : (r.sortIndex = s, t(c, r), m || p || (m = !0, S || (S = !0, ne()))), r;
	}, e.unstable_shouldYield = te, e.unstable_wrapCallback = function(e) {
		var t = f;
		return function() {
			var n = f;
			f = t;
			try {
				return e.apply(this, arguments);
			} finally {
				f = n;
			}
		};
	};
})), n = /* @__PURE__ */ e(((e, n) => {
	n.exports = t();
})), r = /* @__PURE__ */ e(((e) => {
	var t = Symbol.for("react.transitional.element"), n = Symbol.for("react.portal"), r = Symbol.for("react.fragment"), i = Symbol.for("react.strict_mode"), a = Symbol.for("react.profiler"), o = Symbol.for("react.consumer"), s = Symbol.for("react.context"), c = Symbol.for("react.forward_ref"), l = Symbol.for("react.suspense"), u = Symbol.for("react.memo"), d = Symbol.for("react.lazy"), f = Symbol.for("react.activity"), p = Symbol.for("react.view_transition"), m = Symbol.iterator;
	function h(e) {
		return typeof e != "object" || !e ? null : (e = m && e[m] || e["@@iterator"], typeof e == "function" ? e : null);
	}
	var g = {
		isMounted: function() {
			return !1;
		},
		enqueueForceUpdate: function() {},
		enqueueReplaceState: function() {},
		enqueueSetState: function() {}
	}, _ = Object.assign, v = {};
	function y(e, t, n) {
		this.props = e, this.context = t, this.refs = v, this.updater = n || g;
	}
	y.prototype.isReactComponent = {}, y.prototype.setState = function(e, t) {
		if (typeof e != "object" && typeof e != "function" && e != null) throw Error("takes an object of state variables to update or a function which returns an object of state variables.");
		this.updater.enqueueSetState(this, e, t, "setState");
	}, y.prototype.forceUpdate = function(e) {
		this.updater.enqueueForceUpdate(this, e, "forceUpdate");
	};
	function b() {}
	b.prototype = y.prototype;
	function x(e, t, n) {
		this.props = e, this.context = t, this.refs = v, this.updater = n || g;
	}
	var S = x.prototype = new b();
	S.constructor = x, _(S, y.prototype), S.isPureReactComponent = !0;
	var ee = Array.isArray;
	function C() {}
	var w = {
		H: null,
		A: null,
		T: null,
		S: null
	}, te = Object.prototype.hasOwnProperty;
	function T(e, n, r) {
		var i = r.ref;
		return {
			$$typeof: t,
			type: e,
			key: n,
			ref: i === void 0 ? null : i,
			props: r
		};
	}
	function ne(e, t) {
		return T(e.type, t, e.props);
	}
	function re(e) {
		return typeof e == "object" && !!e && e.$$typeof === t;
	}
	function ie(e) {
		var t = {
			"=": "=0",
			":": "=2"
		};
		return "$" + e.replace(/[=:]/g, function(e) {
			return t[e];
		});
	}
	var E = /\/+/g;
	function ae(e, t) {
		return typeof e == "object" && e && e.key != null ? ie("" + e.key) : t.toString(36);
	}
	function oe(e) {
		switch (e.status) {
			case "fulfilled": return e.value;
			case "rejected": throw e.reason;
			default: switch (typeof e.status == "string" ? e.then(C, C) : (e.status = "pending", e.then(function(t) {
				e.status === "pending" && (e.status = "fulfilled", e.value = t);
			}, function(t) {
				e.status === "pending" && (e.status = "rejected", e.reason = t);
			})), e.status) {
				case "fulfilled": return e.value;
				case "rejected": throw e.reason;
			}
		}
		throw e;
	}
	function se(e, r, i, a, o) {
		var s = typeof e;
		(s === "undefined" || s === "boolean") && (e = null);
		var c = !1;
		if (e === null) c = !0;
		else switch (s) {
			case "bigint":
			case "string":
			case "number":
				c = !0;
				break;
			case "object": switch (e.$$typeof) {
				case t:
				case n:
					c = !0;
					break;
				case d: return c = e._init, se(c(e._payload), r, i, a, o);
			}
		}
		if (c) return o = o(e), c = a === "" ? "." + ae(e, 0) : a, ee(o) ? (i = "", c != null && (i = c.replace(E, "$&/") + "/"), se(o, r, i, "", function(e) {
			return e;
		})) : o != null && (re(o) && (o = ne(o, i + (o.key == null || e && e.key === o.key ? "" : ("" + o.key).replace(E, "$&/") + "/") + c)), r.push(o)), 1;
		c = 0;
		var l = a === "" ? "." : a + ":";
		if (ee(e)) for (var u = 0; u < e.length; u++) a = e[u], s = l + ae(a, u), c += se(a, r, i, s, o);
		else if (u = h(e), typeof u == "function") for (e = u.call(e), u = 0; !(a = e.next()).done;) a = a.value, s = l + ae(a, u++), c += se(a, r, i, s, o);
		else if (s === "object") {
			if (typeof e.then == "function") return se(oe(e), r, i, a, o);
			throw r = String(e), Error("Objects are not valid as a React child (found: " + (r === "[object Object]" ? "object with keys {" + Object.keys(e).join(", ") + "}" : r) + "). If you meant to render a collection of children, use an array instead.");
		}
		return c;
	}
	function ce(e, t, n) {
		if (e == null) return e;
		var r = [], i = 0;
		return se(e, r, "", "", function(e) {
			return t.call(n, e, i++);
		}), r;
	}
	function le(e) {
		if (e._status === -1) {
			var t = e._result, n = t();
			n.then(function(t) {
				(e._status === 0 || e._status === -1) && (e._status = 1, e._result = t, n.status === void 0 && (n.status = "fulfilled", n.value = t));
			}, function(t) {
				(e._status === 0 || e._status === -1) && (e._status = 2, e._result = t, n.status === void 0 && (n.status = "rejected", n.reason = t));
			}), e._status === -1 && (e._status = 0, e._result = n);
		}
		if (e._status === 1) return e._result.default;
		throw e._result;
	}
	var D = typeof reportError == "function" ? reportError : function(e) {
		if (typeof window == "object" && typeof window.ErrorEvent == "function") {
			var t = new window.ErrorEvent("error", {
				bubbles: !0,
				cancelable: !0,
				message: typeof e == "object" && e && typeof e.message == "string" ? String(e.message) : String(e),
				error: e
			});
			if (!window.dispatchEvent(t)) return;
		} else if (typeof process == "object" && typeof process.emit == "function") {
			process.emit("uncaughtException", e);
			return;
		}
		console.error(e);
	};
	function ue(e) {
		var t = w.T, n = {};
		n.types = t === null ? null : t.types, w.T = n;
		try {
			var r = e(), i = w.S;
			i !== null && i(n, r), typeof r == "object" && r && typeof r.then == "function" && r.then(C, D);
		} catch (e) {
			D(e);
		} finally {
			t !== null && n.types !== null && (t.types = n.types), w.T = t;
		}
	}
	function de(e) {
		var t = w.T;
		if (t !== null) {
			var n = t.types;
			n === null ? t.types = [e] : n.indexOf(e) === -1 && n.push(e);
		} else ue(de.bind(null, e));
	}
	var O = {
		map: ce,
		forEach: function(e, t, n) {
			ce(e, function() {
				t.apply(this, arguments);
			}, n);
		},
		count: function(e) {
			var t = 0;
			return ce(e, function() {
				t++;
			}), t;
		},
		toArray: function(e) {
			return ce(e, function(e) {
				return e;
			}) || [];
		},
		only: function(e) {
			if (!re(e)) throw Error("React.Children.only expected to receive a single React element child.");
			return e;
		}
	};
	e.Activity = f, e.Children = O, e.Component = y, e.Fragment = r, e.Profiler = a, e.PureComponent = x, e.StrictMode = i, e.Suspense = l, e.ViewTransition = p, e.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = w, e.__COMPILER_RUNTIME = {
		__proto__: null,
		c: function(e) {
			return w.H.useMemoCache(e);
		}
	}, e.addTransitionType = de, e.cache = function(e) {
		return function() {
			return e.apply(null, arguments);
		};
	}, e.cacheSignal = function() {
		return null;
	}, e.cloneElement = function(e, t, n) {
		if (e == null) throw Error("The argument must be a React element, but you passed " + e + ".");
		var r = _({}, e.props), i = e.key;
		if (t != null) for (a in t.key !== void 0 && (i = "" + t.key), t) !te.call(t, a) || a === "key" || a === "__self" || a === "__source" || a === "ref" && t.ref === void 0 || (r[a] = t[a]);
		var a = arguments.length - 2;
		if (a === 1) r.children = n;
		else if (1 < a) {
			for (var o = Array(a), s = 0; s < a; s++) o[s] = arguments[s + 2];
			r.children = o;
		}
		return T(e.type, i, r);
	}, e.createContext = function(e) {
		return e = {
			$$typeof: s,
			_currentValue: e,
			_currentValue2: e,
			_threadCount: 0,
			Provider: null,
			Consumer: null
		}, e.Provider = e, e.Consumer = {
			$$typeof: o,
			_context: e
		}, e;
	}, e.createElement = function(e, t, n) {
		var r, i = {}, a = null;
		if (t != null) for (r in t.key !== void 0 && (a = "" + t.key), t) te.call(t, r) && r !== "key" && r !== "__self" && r !== "__source" && (i[r] = t[r]);
		var o = arguments.length - 2;
		if (o === 1) i.children = n;
		else if (1 < o) {
			for (var s = Array(o), c = 0; c < o; c++) s[c] = arguments[c + 2];
			i.children = s;
		}
		if (e && e.defaultProps) for (r in o = e.defaultProps, o) i[r] === void 0 && (i[r] = o[r]);
		return T(e, a, i);
	}, e.createRef = function() {
		return { current: null };
	}, e.forwardRef = function(e) {
		return {
			$$typeof: c,
			render: e
		};
	}, e.isValidElement = re, e.lazy = function(e) {
		return {
			$$typeof: d,
			_payload: {
				_status: -1,
				_result: e
			},
			_init: le
		};
	}, e.memo = function(e, t) {
		return {
			$$typeof: u,
			type: e,
			compare: t === void 0 ? null : t
		};
	}, e.startTransition = ue, e.unstable_useCacheRefresh = function() {
		return w.H.useCacheRefresh();
	}, e.use = function(e) {
		return w.H.use(e);
	}, e.useActionState = function(e, t, n) {
		return w.H.useActionState(e, t, n);
	}, e.useCallback = function(e, t) {
		return w.H.useCallback(e, t);
	}, e.useContext = function(e) {
		return w.H.useContext(e);
	}, e.useDebugValue = function() {}, e.useDeferredValue = function(e, t) {
		return w.H.useDeferredValue(e, t);
	}, e.useEffect = function(e, t) {
		return w.H.useEffect(e, t);
	}, e.useEffectEvent = function(e) {
		return w.H.useEffectEvent(e);
	}, e.useId = function() {
		return w.H.useId();
	}, e.useImperativeHandle = function(e, t, n) {
		return w.H.useImperativeHandle(e, t, n);
	}, e.useInsertionEffect = function(e, t) {
		return w.H.useInsertionEffect(e, t);
	}, e.useLayoutEffect = function(e, t) {
		return w.H.useLayoutEffect(e, t);
	}, e.useMemo = function(e, t) {
		return w.H.useMemo(e, t);
	}, e.useOptimistic = function(e, t) {
		return w.H.useOptimistic(e, t);
	}, e.useReducer = function(e, t, n) {
		return w.H.useReducer(e, t, n);
	}, e.useRef = function(e) {
		return w.H.useRef(e);
	}, e.useState = function(e) {
		return w.H.useState(e);
	}, e.useSyncExternalStore = function(e, t, n) {
		return w.H.useSyncExternalStore(e, t, n);
	}, e.useTransition = function() {
		return w.H.useTransition();
	}, e.version = "19.3.1";
})), i = /* @__PURE__ */ e(((e, t) => {
	t.exports = r();
})), a = /* @__PURE__ */ e(((e) => {
	var t = i();
	function n(e) {
		var t = "https://react.dev/errors/" + e;
		if (1 < arguments.length) {
			t += "?args[]=" + encodeURIComponent(arguments[1]);
			for (var n = 2; n < arguments.length; n++) t += "&args[]=" + encodeURIComponent(arguments[n]);
		}
		return "Minified React error #" + e + "; visit " + t + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
	}
	function r() {}
	var a = {
		d: {
			f: r,
			r: function() {
				throw Error(n(522));
			},
			D: r,
			C: r,
			L: r,
			m: r,
			X: r,
			S: r,
			M: r
		},
		p: 0,
		findDOMNode: null
	}, o = Symbol.for("react.portal"), s = Symbol.for("react.recoverable"), c = Symbol.for("react.optimistic_key");
	function l(e, t, n) {
		var r = 3 < arguments.length && arguments[3] !== void 0 ? arguments[3] : null;
		return {
			$$typeof: o,
			key: r == null ? null : r === c ? c : "" + r,
			children: e,
			containerInfo: t,
			implementation: n
		};
	}
	var u = t.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
	function d(e, t) {
		if (e === "font") return "";
		if (typeof t == "string") return t === "use-credentials" ? t : "";
	}
	e.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = a, e.browser = function(e) {
		return {
			$$typeof: s,
			_reason: e
		};
	}, e.createPortal = function(e, t) {
		var r = 2 < arguments.length && arguments[2] !== void 0 ? arguments[2] : null;
		if (!t || t.nodeType !== 1 && t.nodeType !== 9 && t.nodeType !== 11) throw Error(n(299));
		return l(e, t, null, r);
	}, e.flushSync = function(e) {
		var t = u.T, n = a.p;
		try {
			if (u.T = null, a.p = 2, e) return e();
		} finally {
			u.T = t, a.p = n, a.d.f();
		}
	}, e.preconnect = function(e, t) {
		typeof e == "string" && (t ? (t = t.crossOrigin, t = typeof t == "string" ? t === "use-credentials" ? t : "" : void 0) : t = null, a.d.C(e, t));
	}, e.prefetchDNS = function(e) {
		typeof e == "string" && a.d.D(e);
	}, e.preinit = function(e, t) {
		if (typeof e == "string" && t && typeof t.as == "string") {
			var n = t.as, r = d(n, t.crossOrigin), i = typeof t.integrity == "string" ? t.integrity : void 0, o = typeof t.fetchPriority == "string" ? t.fetchPriority : void 0;
			n === "style" ? a.d.S(e, typeof t.precedence == "string" ? t.precedence : void 0, {
				crossOrigin: r,
				integrity: i,
				fetchPriority: o
			}) : n === "script" && a.d.X(e, {
				crossOrigin: r,
				integrity: i,
				fetchPriority: o,
				nonce: typeof t.nonce == "string" ? t.nonce : void 0
			});
		}
	}, e.preinitModule = function(e, t) {
		if (typeof e == "string") {
			if (typeof t == "object" && t) {
				if (t.as == null || t.as === "script") {
					var n = d(t.as, t.crossOrigin);
					a.d.M(e, {
						crossOrigin: n,
						integrity: typeof t.integrity == "string" ? t.integrity : void 0,
						nonce: typeof t.nonce == "string" ? t.nonce : void 0,
						fetchPriority: typeof t.fetchPriority == "string" ? t.fetchPriority : void 0
					});
				}
			} else t ?? a.d.M(e);
		}
	}, e.preload = function(e, t) {
		if (typeof e == "string" && typeof t == "object" && t && typeof t.as == "string") {
			var n = t.as, r = d(n, t.crossOrigin);
			a.d.L(e, n, {
				crossOrigin: r,
				integrity: typeof t.integrity == "string" ? t.integrity : void 0,
				nonce: typeof t.nonce == "string" ? t.nonce : void 0,
				type: typeof t.type == "string" ? t.type : void 0,
				fetchPriority: typeof t.fetchPriority == "string" ? t.fetchPriority : void 0,
				referrerPolicy: typeof t.referrerPolicy == "string" ? t.referrerPolicy : void 0,
				imageSrcSet: typeof t.imageSrcSet == "string" ? t.imageSrcSet : void 0,
				imageSizes: typeof t.imageSizes == "string" ? t.imageSizes : void 0,
				media: typeof t.media == "string" ? t.media : void 0
			});
		}
	}, e.preloadModule = function(e, t) {
		if (typeof e == "string") {
			if (t) {
				var n = d(t.as, t.crossOrigin);
				a.d.m(e, {
					as: typeof t.as == "string" && t.as !== "script" ? t.as : void 0,
					crossOrigin: n,
					integrity: typeof t.integrity == "string" ? t.integrity : void 0,
					nonce: typeof t.nonce == "string" ? t.nonce : void 0,
					fetchPriority: typeof t.fetchPriority == "string" ? t.fetchPriority : void 0
				});
			} else a.d.m(e);
		}
	}, e.requestFormReset = function(e) {
		a.d.r(e);
	}, e.unstable_batchedUpdates = function(e, t) {
		return e(t);
	}, e.useFormState = function(e, t, n) {
		return u.H.useFormState(e, t, n);
	}, e.useFormStatus = function() {
		return u.H.useHostTransitionStatus();
	}, e.version = "19.3.1";
})), o = /* @__PURE__ */ e(((e, t) => {
	function n() {
		if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u" && typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE == "function") try {
			__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(n);
		} catch (e) {
			console.error(e);
		}
	}
	n(), t.exports = a();
})), s = /* @__PURE__ */ e(((e) => {
	var t = n(), r = i(), a = o();
	function s(e) {
		var t = "https://react.dev/errors/" + e;
		if (1 < arguments.length) {
			t += "?args[]=" + encodeURIComponent(arguments[1]);
			for (var n = 2; n < arguments.length; n++) t += "&args[]=" + encodeURIComponent(arguments[n]);
		}
		return "Minified React error #" + e + "; visit " + t + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
	}
	function c(e) {
		return !(!e || e.nodeType !== 1 && e.nodeType !== 9 && e.nodeType !== 11);
	}
	function l(e) {
		for (var t = e, n = t; n && !n.alternate;) t = n, t.flags & 4098 && (e = t.return), n = t.return;
		for (; t.return;) t = t.return;
		return t.tag === 3 ? e : null;
	}
	function u(e) {
		if (e.tag === 13) {
			var t = e.memoizedState;
			if (t === null && (e = e.alternate, e !== null && (t = e.memoizedState)), t !== null) return t.dehydrated;
		}
		return null;
	}
	function d(e) {
		if (e.tag === 31) {
			var t = e.memoizedState;
			if (t === null && (e = e.alternate, e !== null && (t = e.memoizedState)), t !== null) return t.dehydrated;
		}
		return null;
	}
	function f(e) {
		if (l(e) !== e) throw Error(s(188));
	}
	function p(e) {
		var t = e.alternate;
		if (!t) {
			if (t = l(e), t === null) throw Error(s(188));
			return t === e ? e : null;
		}
		for (var n = e, r = t;;) {
			var i = n.return;
			if (i === null) break;
			var a = i.alternate;
			if (a === null) {
				if (r = i.return, r !== null) {
					n = r;
					continue;
				}
				break;
			}
			if (i.child === a.child) {
				for (a = i.child; a;) {
					if (a === n) return f(i), e;
					if (a === r) return f(i), t;
					a = a.sibling;
				}
				throw Error(s(188));
			}
			if (n.return !== r.return) n = i, r = a;
			else {
				for (var o = !1, c = i.child; c;) {
					if (c === n) {
						o = !0, n = i, r = a;
						break;
					}
					if (c === r) {
						o = !0, r = i, n = a;
						break;
					}
					c = c.sibling;
				}
				if (!o) {
					for (c = a.child; c;) {
						if (c === n) {
							o = !0, n = a, r = i;
							break;
						}
						if (c === r) {
							o = !0, r = a, n = i;
							break;
						}
						c = c.sibling;
					}
					if (!o) throw Error(s(189));
				}
			}
			if (n.alternate !== r) throw Error(s(190));
		}
		if (n.tag !== 3) throw Error(s(188));
		return n.stateNode.current === n ? e : t;
	}
	function m(e) {
		var t = e.tag;
		if (t === 5 || t === 26 || t === 27 || t === 6) return e;
		for (e = e.child; e !== null;) {
			if (t = m(e), t !== null) return t;
			e = e.sibling;
		}
		return null;
	}
	function h(e, t, n, r, i, a) {
		for (; e !== null;) {
			if ((e.tag === 5 || e.tag === 27 || e.tag === 6) && n(e, r, i, a) || (e.tag !== 22 || e.memoizedState === null) && (t || e.tag !== 5 && e.tag !== 27) && h(e.child, t, n, r, i, a)) return !0;
			e = e.sibling;
		}
		return !1;
	}
	function g(e) {
		for (e = e.return; e !== null;) {
			if (e.tag === 3 || e.tag === 5 || e.tag === 27) return e;
			e = e.return;
		}
		return null;
	}
	function _(e) {
		var t = !1;
		for (e = e.return; e !== null && (e.tag === 4 && (t = !0), e.tag !== 3 && e.tag !== 5 && e.tag !== 27);) e = e.return;
		return t;
	}
	function v(e) {
		var t = [null, null], n = g(e);
		return n === null || y(t, e, n.child, { foundSelf: !1 }), t;
	}
	function y(e, t, n, r) {
		for (; n !== null;) {
			if (n === t) r.foundSelf = !0;
			else if (n.tag === 5 || n.tag === 27 || n.tag === 6) {
				if (r.foundSelf) return e[1] = n, !0;
				e[0] = n;
			} else if ((n.tag !== 22 || n.memoizedState === null) && y(e, t, n.child, r)) return !0;
			n = n.sibling;
		}
		return !1;
	}
	function b(e) {
		switch (e.tag) {
			case 5:
			case 27:
			case 6: return e.stateNode;
			case 3: return e.stateNode.containerInfo;
			default: throw Error(s(559));
		}
	}
	var x = null, S = null;
	function ee(e, t, n) {
		return e === n || e === t && (x = e, !0);
	}
	function C(e, t, n) {
		return e === n ? (S = e, !1) : e === t && (S !== null && (x = e), !0);
	}
	function w(e) {
		if (e === null) return null;
		do
			e = e === null ? null : e.return;
		while (e && e.tag !== 5 && e.tag !== 27 && e.tag !== 3);
		return e || null;
	}
	function te(e, t, n) {
		for (var r = 0, i = e; i; i = n(i)) r++;
		i = 0;
		for (var a = t; a; a = n(a)) i++;
		for (; 0 < r - i;) e = n(e), r--;
		for (; 0 < i - r;) t = n(t), i--;
		for (; r--;) {
			if (e === t || t !== null && e === t.alternate) return e;
			e = n(e), t = n(t);
		}
		return null;
	}
	var T = Object.assign, ne = Symbol.for("react.element"), re = Symbol.for("react.transitional.element"), ie = Symbol.for("react.portal"), E = Symbol.for("react.fragment"), ae = Symbol.for("react.strict_mode"), oe = Symbol.for("react.profiler"), se = Symbol.for("react.consumer"), ce = Symbol.for("react.context"), le = Symbol.for("react.forward_ref"), D = Symbol.for("react.suspense"), ue = Symbol.for("react.suspense_list"), de = Symbol.for("react.memo"), O = Symbol.for("react.lazy"), fe = Symbol.for("react.activity"), pe = Symbol.for("react.legacy_hidden"), me = Symbol.for("react.memo_cache_sentinel"), he = Symbol.for("react.view_transition"), ge = Symbol.for("react.recoverable"), _e = Symbol.iterator;
	function ve(e) {
		return typeof e != "object" || !e ? null : (e = _e && e[_e] || e["@@iterator"], typeof e == "function" ? e : null);
	}
	var ye = Symbol.for("react.client.reference");
	function be(e) {
		if (e == null) return null;
		if (typeof e == "function") return e.$$typeof === ye ? null : e.displayName || e.name || null;
		if (typeof e == "string") return e;
		switch (e) {
			case E: return "Fragment";
			case oe: return "Profiler";
			case ae: return "StrictMode";
			case D: return "Suspense";
			case ue: return "SuspenseList";
			case fe: return "Activity";
			case he: return "ViewTransition";
		}
		if (typeof e == "object") switch (e.$$typeof) {
			case ie: return "Portal";
			case ce: return e.displayName || "Context";
			case se: return (e._context.displayName || "Context") + ".Consumer";
			case le:
				var t = e.render;
				return e = e.displayName, e ||= (e = t.displayName || t.name || "", e === "" ? "ForwardRef" : "ForwardRef(" + e + ")"), e;
			case de: return t = e.displayName || null, t === null ? be(e.type) || "Memo" : t;
			case O:
				t = e._payload, e = e._init;
				try {
					return be(e(t));
				} catch {}
		}
		return null;
	}
	var xe = Array.isArray, k = r.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, A = a.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, j = {
		pending: !1,
		data: null,
		method: null,
		action: null
	}, Se = [], Ce = -1;
	function we(e) {
		return { current: e };
	}
	function Te(e) {
		0 > Ce || (e.current = Se[Ce], Se[Ce] = null, Ce--);
	}
	function M(e, t) {
		Ce++, Se[Ce] = e.current, e.current = t;
	}
	var Ee = we(null), De = we(null), Oe = we(null), ke = we(null);
	function Ae(e, t) {
		switch (M(Oe, t), M(De, e), M(Ee, null), t.nodeType) {
			case 9:
			case 11:
				e = (e = t.documentElement) && (e = e.namespaceURI) ? up(e) : 0;
				break;
			default: if (e = t.tagName, t = t.namespaceURI) t = up(t), e = dp(t, e);
			else switch (e) {
				case "svg":
					e = 1;
					break;
				case "math":
					e = 2;
					break;
				default: e = 0;
			}
		}
		Te(Ee), M(Ee, e);
	}
	function je() {
		Te(Ee), Te(De), Te(Oe);
	}
	function Me(e) {
		var t = e.memoizedState;
		t !== null && (sh._currentValue = t.memoizedState, M(ke, e)), t = Ee.current;
		var n = dp(t, e.type);
		t !== n && (M(De, e), M(Ee, n));
	}
	function Ne(e) {
		De.current === e && (Te(Ee), Te(De)), ke.current === e && (Te(ke), sh._currentValue = j);
	}
	var Pe, Fe;
	function Ie(e) {
		if (Pe === void 0) try {
			throw Error();
		} catch (e) {
			var t = e.stack.trim().match(/\n( *(at )?)/);
			Pe = t && t[1] || "", Fe = -1 < e.stack.indexOf("\n    at") ? " (<anonymous>)" : -1 < e.stack.indexOf("@") ? "@unknown:0:0" : "";
		}
		return "\n" + Pe + e + Fe;
	}
	var N = !1;
	function Le(e, t) {
		if (!e || N) return "";
		N = !0;
		var n = Error.prepareStackTrace;
		Error.prepareStackTrace = void 0;
		try {
			var r = { DetermineComponentFrameRoot: function() {
				try {
					if (t) {
						var n = function() {
							throw Error();
						};
						if (Object.defineProperty(n.prototype, "props", { set: function() {
							throw Error();
						} }), typeof Reflect == "object" && Reflect.construct) {
							try {
								Reflect.construct(n, []);
							} catch (e) {
								var r = e;
							}
							Reflect.construct(e, [], n);
						} else {
							try {
								n.call();
							} catch (e) {
								r = e;
							}
							n = !1;
							try {
								var i = Object.getOwnPropertyDescriptor(e.prototype, "props");
								Object.defineProperty(e.prototype, "props", {
									configurable: !0,
									set: function() {
										throw Error();
									}
								}), n = !0, new e();
							} finally {
								n && (i === void 0 ? delete e.prototype.props : Object.defineProperty(e.prototype, "props", i));
							}
						}
					} else {
						try {
							throw Error();
						} catch (e) {
							r = e;
						}
						(n = e()) && typeof n.catch == "function" && n.catch(function() {});
					}
				} catch (e) {
					if (e && r && typeof e.stack == "string") return [e.stack, r.stack];
				}
				return [null, null];
			} };
			r.DetermineComponentFrameRoot.displayName = "DetermineComponentFrameRoot";
			var i = Object.getOwnPropertyDescriptor(r.DetermineComponentFrameRoot, "name");
			i && i.configurable && Object.defineProperty(r.DetermineComponentFrameRoot, "name", { value: "DetermineComponentFrameRoot" });
			var a = r.DetermineComponentFrameRoot(), o = a[0], s = a[1];
			if (o && s) {
				var c = o.split("\n"), l = s.split("\n");
				for (i = r = 0; r < c.length && !c[r].includes("DetermineComponentFrameRoot");) r++;
				for (; i < l.length && !l[i].includes("DetermineComponentFrameRoot");) i++;
				if (r === c.length || i === l.length) for (r = c.length - 1, i = l.length - 1; 1 <= r && 0 <= i && c[r] !== l[i];) i--;
				for (; 1 <= r && 0 <= i; r--, i--) if (c[r] !== l[i]) {
					if (r !== 1 || i !== 1) do
						if (r--, i--, 0 > i || c[r] !== l[i]) {
							var u = "\n" + c[r].replace(" at new ", " at ");
							return e.displayName && u.includes("<anonymous>") && (u = u.replace("<anonymous>", e.displayName)), u;
						}
					while (1 <= r && 0 <= i);
					break;
				}
			}
		} finally {
			N = !1, Error.prepareStackTrace = n;
		}
		return (n = e ? e.displayName || e.name : "") ? Ie(n) : "";
	}
	function P(e, t) {
		switch (e.tag) {
			case 26:
			case 27:
			case 5: return Ie(e.type);
			case 16: return Ie("Lazy");
			case 13: return e.child !== t && t !== null ? Ie("Suspense Fallback") : Ie("Suspense");
			case 19: return Ie("SuspenseList");
			case 0:
			case 15: return Le(e.type, !1);
			case 11: return Le(e.type.render, !1);
			case 1: return Le(e.type, !0);
			case 31: return Ie("Activity");
			case 30: return Ie("ViewTransition");
			default: return "";
		}
	}
	function Re(e) {
		try {
			var t = "", n = null;
			do
				t += P(e, n), n = e, e = e.return;
			while (e);
			return t;
		} catch (e) {
			return "\nError generating stack: " + e.message + "\n" + e.stack;
		}
	}
	var ze = Object.prototype.hasOwnProperty, Be = t.unstable_scheduleCallback, Ve = t.unstable_cancelCallback, He = t.unstable_shouldYield, Ue = t.unstable_requestPaint, We = t.unstable_now, Ge = t.unstable_getCurrentPriorityLevel, Ke = t.unstable_ImmediatePriority, qe = t.unstable_UserBlockingPriority, Je = t.unstable_NormalPriority, Ye = t.unstable_LowPriority, Xe = t.unstable_IdlePriority, Ze = t.log, Qe = t.unstable_setDisableYieldValue, $e = null, et = null;
	function F(e) {
		if (typeof Ze == "function" && Qe(e), et && typeof et.setStrictMode == "function") try {
			et.setStrictMode($e, e);
		} catch {}
	}
	var tt = Math.clz32 ? Math.clz32 : it, nt = Math.log, rt = Math.LN2;
	function it(e) {
		return e >>>= 0, e === 0 ? 32 : 31 - (nt(e) / rt | 0) | 0;
	}
	var at = 256, ot = 262144, st = 4194304;
	function ct(e) {
		var t = e & 42;
		if (t !== 0) return t;
		switch (e & -e) {
			case 1: return 1;
			case 2: return 2;
			case 4: return 4;
			case 8: return 8;
			case 16: return 16;
			case 32: return 32;
			case 64: return 64;
			case 128: return 128;
			case 256:
			case 512:
			case 1024:
			case 2048:
			case 4096:
			case 8192:
			case 16384:
			case 32768:
			case 65536:
			case 131072: return e & -e;
			case 262144:
			case 524288:
			case 1048576:
			case 2097152: return e & 3932160;
			case 4194304:
			case 8388608:
			case 16777216:
			case 33554432: return e & 62914560;
			case 67108864: return 67108864;
			case 134217728: return 134217728;
			case 268435456: return 268435456;
			case 536870912: return 536870912;
			case 1073741824: return 0;
			default: return e;
		}
	}
	function lt(e, t, n) {
		var r = e.pendingLanes;
		if (r === 0) return 0;
		var i = 0, a = e.suspendedLanes, o = e.pingedLanes;
		e = e.warmLanes;
		var s = r & 134217727;
		return s === 0 ? (s = r & ~a, s === 0 ? o === 0 ? n || (n = r & ~e, n !== 0 && (i = ct(n))) : i = ct(o) : i = ct(s)) : (r = s & ~a, r === 0 ? (o &= s, o === 0 ? n || (n = s & ~e, n !== 0 && (i = ct(n))) : i = ct(o)) : i = ct(r)), i === 0 ? 0 : t !== 0 && t !== i && (t & a) === 0 && (a = i & -i, n = t & -t, a >= n || a === 32 && n & 4194048) ? t : i;
	}
	function ut(e, t) {
		return (e.pendingLanes & ~(e.suspendedLanes & ~e.pingedLanes) & t) === 0;
	}
	function dt(e, t) {
		t & 8 && (t |= t & 32);
		var n = e.entangledLanes;
		if (n !== 0) for (e = e.entanglements, n &= t; 0 < n;) {
			var r = 31 - tt(n), i = 1 << r;
			t |= e[r], n &= ~i;
		}
		return t;
	}
	function ft(e, t) {
		switch (e) {
			case 1:
			case 2:
			case 4:
			case 8:
			case 64: return t + 250;
			case 16:
			case 32:
			case 128:
			case 256:
			case 512:
			case 1024:
			case 2048:
			case 4096:
			case 8192:
			case 16384:
			case 32768:
			case 65536:
			case 131072:
			case 262144:
			case 524288:
			case 1048576:
			case 2097152: return t + 5e3;
			case 4194304:
			case 8388608:
			case 16777216:
			case 33554432: return -1;
			case 67108864:
			case 134217728:
			case 268435456:
			case 536870912:
			case 1073741824: return -1;
			default: return -1;
		}
	}
	function pt() {
		var e = st;
		return st <<= 1, !(st & 62914560) && (st = 4194304), e;
	}
	function mt(e) {
		for (var t = [], n = 0; 31 > n; n++) t.push(e);
		return t;
	}
	function ht(e, t) {
		e.pendingLanes |= t, t !== 268435456 && (e.suspendedLanes = 0, e.pingedLanes = 0, e.warmLanes = 0);
	}
	function gt(e, t, n, r, i, a) {
		var o = e.pendingLanes;
		e.pendingLanes = n, e.suspendedLanes = 0, e.pingedLanes = 0, e.warmLanes = 0, e.expiredLanes &= n, e.entangledLanes &= n, e.errorRecoveryDisabledLanes &= n, e.shellSuspendCounter = 0;
		var s = e.entanglements, c = e.expirationTimes, l = e.hiddenUpdates;
		for (n = o & ~n; 0 < n;) {
			var u = 31 - tt(n), d = 1 << u;
			s[u] = 0, c[u] = -1;
			var f = l[u];
			if (f !== null) for (l[u] = null, u = 0; u < f.length; u++) {
				var p = f[u];
				p !== null && (p.lane &= -536870913);
			}
			n &= ~d;
		}
		r !== 0 && _t(e, r, 0), a !== 0 && i === 0 && e.tag !== 0 && (e.suspendedLanes |= a & ~(o & ~t));
	}
	function _t(e, t, n) {
		e.pendingLanes |= t, e.suspendedLanes &= ~t;
		var r = 31 - tt(t);
		e.entangledLanes |= t, e.entanglements[r] = e.entanglements[r] | 1073741824 | n & 261930;
	}
	function vt(e, t) {
		var n = e.entangledLanes |= t;
		for (e = e.entanglements; n;) {
			var r = 31 - tt(n), i = 1 << r;
			i & t | e[r] & t && (e[r] |= t), n &= ~i;
		}
	}
	function I(e, t) {
		var n = t & -t;
		return n = n & 42 ? 1 : L(n), (n & (e.suspendedLanes | t)) === 0 ? n : 0;
	}
	function L(e) {
		switch (e) {
			case 2:
				e = 1;
				break;
			case 8:
				e = 4;
				break;
			case 32:
				e = 16;
				break;
			case 256:
			case 512:
			case 1024:
			case 2048:
			case 4096:
			case 8192:
			case 16384:
			case 32768:
			case 65536:
			case 131072:
			case 262144:
			case 524288:
			case 1048576:
			case 2097152:
			case 4194304:
			case 8388608:
			case 16777216:
			case 33554432:
				e = 128;
				break;
			case 268435456:
				e = 134217728;
				break;
			default: e = 0;
		}
		return e;
	}
	function yt(e) {
		return e &= -e, 2 < e ? 8 < e ? e & 134217727 ? 32 : 268435456 : 8 : 2;
	}
	function bt() {
		var e = A.p;
		return e === 0 ? (e = window.event, e === void 0 ? 32 : Ch(e.type)) : e;
	}
	function xt(e, t) {
		var n = A.p;
		try {
			return A.p = e, t();
		} finally {
			A.p = n;
		}
	}
	var St = Math.random().toString(36).slice(2), R = "__reactFiber$" + St, z = "__reactProps$" + St, Ct = "__reactContainer$" + St, wt = "__reactEvents$" + St, Tt = "__reactListeners$" + St, Et = "__reactHandles$" + St, Dt = "__reactResources$" + St, Ot = "__reactMarker$" + St, kt = "__reactLoad$" + St;
	function At(e) {
		delete e[R], delete e[z], delete e[Tt], delete e[Et];
	}
	function jt(e) {
		var t;
		if (t = e[R]) return t;
		for (var n = e.parentNode; n;) {
			if (t = n[Ct] || n[R]) {
				if (n = t.alternate, t.child !== null || n !== null && n.child !== null) for (e = fm(e); e !== null;) {
					if (n = e[R]) return n;
					e = fm(e);
				}
				return t;
			}
			e = n, n = e.parentNode;
		}
		return null;
	}
	function Mt(e) {
		if (e = e[R] || e[Ct]) {
			var t = e.tag;
			if (t === 5 || t === 6 || t === 13 || t === 31 || t === 26 || t === 27 || t === 3) return e;
		}
		return null;
	}
	function Nt(e) {
		var t = e.tag;
		if (t === 5 || t === 26 || t === 27 || t === 6) return e.stateNode;
		throw Error(s(33));
	}
	function Pt(e) {
		var t = e[Dt];
		return t ||= e[Dt] = {
			hoistableStyles: /* @__PURE__ */ new Map(),
			hoistableScripts: /* @__PURE__ */ new Map()
		}, t;
	}
	function Ft(e) {
		e[Ot] = !0;
	}
	function It(e) {
		e[kt] = void 0;
	}
	var Lt = /* @__PURE__ */ new Set(), Rt = {};
	function zt(e, t) {
		Bt(e, t), Bt(e + "Capture", t);
	}
	function Bt(e, t) {
		for (Rt[e] = t, e = 0; e < t.length; e++) Lt.add(t[e]);
	}
	var Vt = RegExp("^[:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD][:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$"), Ht = {}, Ut = {};
	function Wt(e) {
		return ze.call(Ut, e) ? !0 : ze.call(Ht, e) ? !1 : Vt.test(e) ? Ut[e] = !0 : (Ht[e] = !0, !1);
	}
	var B = !1;
	function Gt() {
		var e = B;
		return B = !1, e;
	}
	function Kt(e, t, n) {
		if (Wt(t)) {
			if (n === null) e.removeAttribute(t);
			else {
				switch (typeof n) {
					case "undefined":
					case "function":
					case "symbol":
						e.removeAttribute(t);
						return;
					case "boolean":
						var r = t.toLowerCase().slice(0, 5);
						if (r !== "data-" && r !== "aria-") {
							e.removeAttribute(t);
							return;
						}
				}
				e.setAttribute(t, n);
			}
		}
	}
	function qt(e, t, n) {
		if (n === null) e.removeAttribute(t);
		else {
			switch (typeof n) {
				case "undefined":
				case "function":
				case "symbol":
				case "boolean":
					e.removeAttribute(t);
					return;
			}
			e.setAttribute(t, n);
		}
	}
	function Jt(e, t, n, r) {
		if (r === null) e.removeAttribute(n);
		else {
			switch (typeof r) {
				case "undefined":
				case "function":
				case "symbol":
				case "boolean":
					e.removeAttribute(n);
					return;
			}
			e.setAttributeNS(t, n, r);
		}
	}
	function V(e) {
		switch (typeof e) {
			case "bigint":
			case "boolean":
			case "number":
			case "string":
			case "undefined": return e;
			case "object": return e;
			default: return "";
		}
	}
	function Yt(e) {
		var t = e.type;
		return (e = e.nodeName) && e.toLowerCase() === "input" && (t === "checkbox" || t === "radio");
	}
	function Xt(e, t, n) {
		var r = Object.getOwnPropertyDescriptor(e.constructor.prototype, t);
		if (!e.hasOwnProperty(t) && r !== void 0 && typeof r.get == "function" && typeof r.set == "function") {
			var i = r.get, a = r.set;
			return Object.defineProperty(e, t, {
				configurable: !0,
				get: function() {
					return i.call(this);
				},
				set: function(e) {
					n = "" + e, a.call(this, e);
				}
			}), Object.defineProperty(e, t, { enumerable: r.enumerable }), {
				getValue: function() {
					return n;
				},
				setValue: function(e) {
					n = "" + e;
				},
				stopTracking: function() {
					e._valueTracker = null, delete e[t];
				}
			};
		}
	}
	function Zt(e) {
		if (!e._valueTracker) {
			var t = Yt(e) ? "checked" : "value";
			e._valueTracker = Xt(e, t, "" + e[t]);
		}
	}
	function Qt(e) {
		if (!e) return !1;
		var t = e._valueTracker;
		if (!t) return !0;
		var n = t.getValue(), r = "";
		return e && (r = Yt(e) ? e.checked ? "true" : "false" : e.value), e = r, e !== n && (t.setValue(e), !0);
	}
	var $t = /[\n"\\]/g;
	function en(e) {
		return e.replace($t, function(e) {
			return "\\" + e.charCodeAt(0).toString(16) + " ";
		});
	}
	function tn(e, t, n, r, i, a, o, s) {
		e.name = "", o != null && typeof o != "function" && typeof o != "symbol" && typeof o != "boolean" ? e.type = o : e.removeAttribute("type"), t == null ? o !== "submit" && o !== "reset" || e.removeAttribute("value") : o === "number" ? (t === 0 && e.value === "" || e.value != t) && (e.value = "" + V(t)) : e.value !== "" + V(t) && (e.value = "" + V(t)), t == null ? n == null ? r != null && e.removeAttribute("value") : rn(e, V(n)) : o === "number" && e.value == t ? rn(e, V(e.value)) : rn(e, V(t)), i == null && a != null && (e.defaultChecked = !!a), i != null && (e.checked = i && typeof i != "function" && typeof i != "symbol"), s != null && typeof s != "function" && typeof s != "symbol" && typeof s != "boolean" ? e.name = "" + V(s) : e.removeAttribute("name");
	}
	function nn(e, t, n, r, i, a, o, s) {
		if (a != null && typeof a != "function" && typeof a != "symbol" && typeof a != "boolean" && (e.type = a), t != null || n != null) {
			if (!(a !== "submit" && a !== "reset" || t != null)) {
				Zt(e);
				return;
			}
			n = n == null ? "" : "" + V(n), t = t == null ? n : "" + V(t), s || t === e.value || (e.value = t), e.defaultValue = t;
		}
		r ??= i, r = typeof r != "function" && typeof r != "symbol" && !!r, e.checked = s ? e.checked : !!r, e.defaultChecked = !!r, o != null && typeof o != "function" && typeof o != "symbol" && typeof o != "boolean" && (e.name = o), Zt(e);
	}
	function rn(e, t) {
		e.defaultValue !== "" + t && (e.defaultValue = "" + t);
	}
	function an(e, t, n, r) {
		if (e = e.options, t) {
			t = {};
			for (var i = 0; i < n.length; i++) t["$" + n[i]] = !0;
			for (n = 0; n < e.length; n++) i = t.hasOwnProperty("$" + e[n].value), e[n].selected !== i && (e[n].selected = i), i && r && (e[n].defaultSelected = !0);
		} else {
			for (n = "" + V(n), t = null, i = 0; i < e.length; i++) {
				if (e[i].value === n) {
					e[i].selected = !0, r && (e[i].defaultSelected = !0);
					return;
				}
				t !== null || e[i].disabled || (t = e[i]);
			}
			t !== null && (t.selected = !0);
		}
	}
	function on(e, t, n) {
		t != null && (t = "" + V(t), t !== e.value && (e.value = t), n == null) ? e.defaultValue !== t && (e.defaultValue = t) : e.defaultValue = n == null ? "" : "" + V(n);
	}
	function sn(e, t, n, r) {
		if (t == null) {
			if (r != null) {
				if (n != null) throw Error(s(92));
				if (xe(r)) {
					if (1 < r.length) throw Error(s(93));
					r = r[0];
				}
				n = r;
			}
			n ??= "", t = n;
		}
		n = V(t), e.defaultValue = n, r = e.textContent, r === n && r !== "" && r !== null && (e.value = r), Zt(e);
	}
	function cn(e, t) {
		if (t) {
			var n = e.firstChild;
			if (n && n === e.lastChild && n.nodeType === 3) {
				n.nodeValue = t;
				return;
			}
		}
		e.textContent = t;
	}
	var ln = new Set("animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth MozAnimationIterationCount MozBoxFlex MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount WebkitColumns WebkitFlex WebkitFlexGrow WebkitFlexPositive WebkitFlexShrink WebkitLineClamp".split(" "));
	function un(e, t, n) {
		var r = t.indexOf("--") === 0;
		n == null || typeof n == "boolean" || n === "" ? r ? e.setProperty(t, "") : t === "float" ? e.cssFloat = "" : e[t] = "" : r ? e.setProperty(t, n) : typeof n != "number" || n === 0 || ln.has(t) ? t === "float" ? e.cssFloat = n : e[t] = ("" + n).trim() : e[t] = n + "px";
	}
	function dn(e, t, n) {
		if (t != null && typeof t != "object") throw Error(s(62));
		if (e = e.style, n != null) {
			for (var r in n) !n.hasOwnProperty(r) || t != null && t.hasOwnProperty(r) || (r.indexOf("--") === 0 ? e.setProperty(r, "") : r === "float" ? e.cssFloat = "" : e[r] = "", B = !0);
			for (var i in t) r = t[i], t.hasOwnProperty(i) && n[i] !== r && (un(e, i, r), B = !0);
		} else for (var a in t) t.hasOwnProperty(a) && un(e, a, t[a]);
	}
	function fn(e) {
		if (e.indexOf("-") === -1) return !1;
		switch (e) {
			case "annotation-xml":
			case "color-profile":
			case "font-face":
			case "font-face-src":
			case "font-face-uri":
			case "font-face-format":
			case "font-face-name":
			case "missing-glyph": return !1;
			default: return !0;
		}
	}
	var pn = /* @__PURE__ */ new Map([
		["acceptCharset", "accept-charset"],
		["htmlFor", "for"],
		["httpEquiv", "http-equiv"],
		["crossOrigin", "crossorigin"],
		["accentHeight", "accent-height"],
		["alignmentBaseline", "alignment-baseline"],
		["arabicForm", "arabic-form"],
		["baselineShift", "baseline-shift"],
		["capHeight", "cap-height"],
		["clipPath", "clip-path"],
		["clipRule", "clip-rule"],
		["colorInterpolation", "color-interpolation"],
		["colorInterpolationFilters", "color-interpolation-filters"],
		["colorProfile", "color-profile"],
		["colorRendering", "color-rendering"],
		["dominantBaseline", "dominant-baseline"],
		["enableBackground", "enable-background"],
		["fillOpacity", "fill-opacity"],
		["fillRule", "fill-rule"],
		["floodColor", "flood-color"],
		["floodOpacity", "flood-opacity"],
		["fontFamily", "font-family"],
		["fontSize", "font-size"],
		["fontSizeAdjust", "font-size-adjust"],
		["fontStretch", "font-stretch"],
		["fontStyle", "font-style"],
		["fontVariant", "font-variant"],
		["fontWeight", "font-weight"],
		["glyphName", "glyph-name"],
		["glyphOrientationHorizontal", "glyph-orientation-horizontal"],
		["glyphOrientationVertical", "glyph-orientation-vertical"],
		["horizAdvX", "horiz-adv-x"],
		["horizOriginX", "horiz-origin-x"],
		["imageRendering", "image-rendering"],
		["letterSpacing", "letter-spacing"],
		["lightingColor", "lighting-color"],
		["markerEnd", "marker-end"],
		["markerMid", "marker-mid"],
		["markerStart", "marker-start"],
		["maskType", "mask-type"],
		["overlinePosition", "overline-position"],
		["overlineThickness", "overline-thickness"],
		["paintOrder", "paint-order"],
		["panose-1", "panose-1"],
		["pointerEvents", "pointer-events"],
		["renderingIntent", "rendering-intent"],
		["shapeRendering", "shape-rendering"],
		["stopColor", "stop-color"],
		["stopOpacity", "stop-opacity"],
		["strikethroughPosition", "strikethrough-position"],
		["strikethroughThickness", "strikethrough-thickness"],
		["strokeDasharray", "stroke-dasharray"],
		["strokeDashoffset", "stroke-dashoffset"],
		["strokeLinecap", "stroke-linecap"],
		["strokeLinejoin", "stroke-linejoin"],
		["strokeMiterlimit", "stroke-miterlimit"],
		["strokeOpacity", "stroke-opacity"],
		["strokeWidth", "stroke-width"],
		["textAnchor", "text-anchor"],
		["textDecoration", "text-decoration"],
		["textRendering", "text-rendering"],
		["transformOrigin", "transform-origin"],
		["underlinePosition", "underline-position"],
		["underlineThickness", "underline-thickness"],
		["unicodeBidi", "unicode-bidi"],
		["unicodeRange", "unicode-range"],
		["unitsPerEm", "units-per-em"],
		["vAlphabetic", "v-alphabetic"],
		["vHanging", "v-hanging"],
		["vIdeographic", "v-ideographic"],
		["vMathematical", "v-mathematical"],
		["vectorEffect", "vector-effect"],
		["vertAdvY", "vert-adv-y"],
		["vertOriginX", "vert-origin-x"],
		["vertOriginY", "vert-origin-y"],
		["wordSpacing", "word-spacing"],
		["writingMode", "writing-mode"],
		["xmlnsXlink", "xmlns:xlink"],
		["xHeight", "x-height"]
	]), mn = /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;
	function hn(e) {
		return mn.test("" + e) ? "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')" : e;
	}
	function gn() {}
	var _n = null;
	function vn(e) {
		return e = e.target || e.srcElement || window, e.correspondingUseElement && (e = e.correspondingUseElement), e.nodeType === 3 ? e.parentNode : e;
	}
	var yn = null, bn = null;
	function xn(e) {
		var t = Mt(e);
		if (t && (e = t.stateNode)) {
			var n = e[z] || null;
			a: switch (e = t.stateNode, t.type) {
				case "input":
					if (tn(e, n.value, n.defaultValue, n.defaultValue, n.checked, n.defaultChecked, n.type, n.name), t = n.name, n.type === "radio" && t != null) {
						for (n = e; n.parentNode;) n = n.parentNode;
						for (n = n.querySelectorAll("input[name=\"" + en("" + t) + "\"][type=\"radio\"]"), t = 0; t < n.length; t++) {
							var r = n[t];
							if (r !== e && r.form === e.form) {
								var i = r[z] || null;
								if (!i) throw Error(s(90));
								tn(r, i.value, i.defaultValue, i.defaultValue, i.checked, i.defaultChecked, i.type, i.name);
							}
						}
						for (t = 0; t < n.length; t++) r = n[t], r.form === e.form && Qt(r);
					}
					break a;
				case "textarea":
					on(e, n.value, n.defaultValue);
					break a;
				case "select": t = n.value, t != null && an(e, !!n.multiple, t, !1);
			}
		}
	}
	var Sn = !1;
	function Cn(e, t, n) {
		if (Sn) return e(t, n);
		Sn = !0;
		try {
			return e(t);
		} finally {
			if (Sn = !1, (yn !== null || bn !== null) && (zd(), yn && (t = yn, e = bn, bn = yn = null, xn(t), e))) for (t = 0; t < e.length; t++) xn(e[t]);
		}
	}
	function wn(e, t) {
		var n = e.stateNode;
		if (n === null) return null;
		var r = n[z] || null;
		if (r === null) return null;
		n = r[t];
		a: switch (t) {
			case "onClick":
			case "onClickCapture":
			case "onDoubleClick":
			case "onDoubleClickCapture":
			case "onMouseDown":
			case "onMouseDownCapture":
			case "onMouseMove":
			case "onMouseMoveCapture":
			case "onMouseUp":
			case "onMouseUpCapture":
			case "onMouseEnter":
				(r = !r.disabled) || (e = e.type, r = e !== "button" && e !== "input" && e !== "select" && e !== "textarea"), e = !r;
				break a;
			default: e = !1;
		}
		if (e) return null;
		if (n && typeof n != "function") throw Error(s(231, t, typeof n));
		return n;
	}
	var Tn = typeof window < "u" && window.document !== void 0 && window.document.createElement !== void 0, En = !1;
	if (Tn) try {
		var Dn = {};
		Object.defineProperty(Dn, "passive", { get: function() {
			En = !0;
		} }), window.addEventListener("test", Dn, Dn), window.removeEventListener("test", Dn, Dn);
	} catch {
		En = !1;
	}
	var On = null, kn = null, An = null;
	function jn() {
		if (An) return An;
		var e, t = kn, n = t.length, r, i = "value" in On ? On.value : On.textContent, a = i.length;
		for (e = 0; e < n && t[e] === i[e]; e++);
		var o = n - e;
		for (r = 1; r <= o && t[n - r] === i[a - r]; r++);
		return An = i.slice(e, 1 < r ? 1 - r : void 0);
	}
	function Mn(e) {
		var t = e.keyCode;
		return "charCode" in e ? (e = e.charCode, e === 0 && t === 13 && (e = 13)) : e = t, e === 10 && (e = 13), 32 <= e || e === 13 ? e : 0;
	}
	function Nn() {
		return !0;
	}
	function Pn() {
		return !1;
	}
	function Fn(e) {
		function t(t, n, r, i, a) {
			for (var o in this._reactName = t, this._targetInst = r, this.type = n, this.nativeEvent = i, this.target = a, this.currentTarget = null, e) e.hasOwnProperty(o) && (t = e[o], this[o] = t ? t(i) : i[o]);
			return this.isDefaultPrevented = (i.defaultPrevented == null ? !1 === i.returnValue : i.defaultPrevented) ? Nn : Pn, this.isPropagationStopped = Pn, this;
		}
		return T(t.prototype, {
			preventDefault: function() {
				this.defaultPrevented = !0;
				var e = this.nativeEvent;
				e && (e.preventDefault ? e.preventDefault() : typeof e.returnValue != "unknown" && (e.returnValue = !1), this.isDefaultPrevented = Nn);
			},
			stopPropagation: function() {
				var e = this.nativeEvent;
				e && (e.stopPropagation ? e.stopPropagation() : typeof e.cancelBubble != "unknown" && (e.cancelBubble = !0), this.isPropagationStopped = Nn);
			},
			persist: function() {},
			isPersistent: Nn
		}), t;
	}
	var In = {
		eventPhase: 0,
		bubbles: 0,
		cancelable: 0,
		timeStamp: function(e) {
			return e.timeStamp || Date.now();
		},
		defaultPrevented: 0,
		isTrusted: 0
	}, Ln = Fn(In), Rn = T({}, In, {
		view: 0,
		detail: 0
	}), zn = Fn(Rn), Bn, Vn, Hn, Un = T({}, Rn, {
		screenX: 0,
		screenY: 0,
		clientX: 0,
		clientY: 0,
		pageX: 0,
		pageY: 0,
		ctrlKey: 0,
		shiftKey: 0,
		altKey: 0,
		metaKey: 0,
		getModifierState: er,
		button: 0,
		buttons: 0,
		relatedTarget: function(e) {
			return e.relatedTarget === void 0 ? e.fromElement === e.srcElement ? e.toElement : e.fromElement : e.relatedTarget;
		},
		movementX: function(e) {
			return "movementX" in e ? e.movementX : (e !== Hn && (Hn && e.type === "mousemove" ? (Bn = e.screenX - Hn.screenX, Vn = e.screenY - Hn.screenY) : Vn = Bn = 0, Hn = e), Bn);
		},
		movementY: function(e) {
			return "movementY" in e ? e.movementY : Vn;
		}
	}), Wn = Fn(Un), Gn = Fn(T({}, Un, { dataTransfer: 0 })), Kn = Fn(T({}, Rn, { relatedTarget: 0 })), qn = Fn(T({}, In, {
		animationName: 0,
		elapsedTime: 0,
		pseudoElement: 0
	})), Jn = Fn(T({}, In, { clipboardData: function(e) {
		return "clipboardData" in e ? e.clipboardData : window.clipboardData;
	} })), Yn = Fn(T({}, In, { data: 0 })), Xn = {
		Esc: "Escape",
		Spacebar: " ",
		Left: "ArrowLeft",
		Up: "ArrowUp",
		Right: "ArrowRight",
		Down: "ArrowDown",
		Del: "Delete",
		Win: "OS",
		Menu: "ContextMenu",
		Apps: "ContextMenu",
		Scroll: "ScrollLock",
		MozPrintableKey: "Unidentified"
	}, Zn = {
		8: "Backspace",
		9: "Tab",
		12: "Clear",
		13: "Enter",
		16: "Shift",
		17: "Control",
		18: "Alt",
		19: "Pause",
		20: "CapsLock",
		27: "Escape",
		32: " ",
		33: "PageUp",
		34: "PageDown",
		35: "End",
		36: "Home",
		37: "ArrowLeft",
		38: "ArrowUp",
		39: "ArrowRight",
		40: "ArrowDown",
		45: "Insert",
		46: "Delete",
		112: "F1",
		113: "F2",
		114: "F3",
		115: "F4",
		116: "F5",
		117: "F6",
		118: "F7",
		119: "F8",
		120: "F9",
		121: "F10",
		122: "F11",
		123: "F12",
		144: "NumLock",
		145: "ScrollLock",
		224: "Meta"
	}, Qn = {
		Alt: "altKey",
		Control: "ctrlKey",
		Meta: "metaKey",
		Shift: "shiftKey"
	};
	function $n(e) {
		var t = this.nativeEvent;
		return t.getModifierState ? t.getModifierState(e) : (e = Qn[e]) ? !!t[e] : !1;
	}
	function er() {
		return $n;
	}
	var tr = Fn(T({}, Rn, {
		key: function(e) {
			if (e.key) {
				var t = Xn[e.key] || e.key;
				if (t !== "Unidentified") return t;
			}
			return e.type === "keypress" ? (e = Mn(e), e === 13 ? "Enter" : String.fromCharCode(e)) : e.type === "keydown" || e.type === "keyup" ? Zn[e.keyCode] || "Unidentified" : "";
		},
		code: 0,
		location: 0,
		ctrlKey: 0,
		shiftKey: 0,
		altKey: 0,
		metaKey: 0,
		repeat: 0,
		locale: 0,
		getModifierState: er,
		charCode: function(e) {
			return e.type === "keypress" ? Mn(e) : 0;
		},
		keyCode: function(e) {
			return e.type === "keydown" || e.type === "keyup" ? e.keyCode : 0;
		},
		which: function(e) {
			return e.type === "keypress" ? Mn(e) : e.type === "keydown" || e.type === "keyup" ? e.keyCode : 0;
		}
	})), nr = Fn(T({}, Un, {
		pointerId: 0,
		width: 0,
		height: 0,
		pressure: 0,
		tangentialPressure: 0,
		tiltX: 0,
		tiltY: 0,
		twist: 0,
		pointerType: 0,
		isPrimary: 0
	})), rr = Fn(T({}, In, { submitter: 0 })), ir = Fn(T({}, Rn, {
		touches: 0,
		targetTouches: 0,
		changedTouches: 0,
		altKey: 0,
		metaKey: 0,
		ctrlKey: 0,
		shiftKey: 0,
		getModifierState: er
	})), ar = Fn(T({}, In, {
		propertyName: 0,
		elapsedTime: 0,
		pseudoElement: 0
	})), or = Fn(T({}, Un, {
		deltaX: function(e) {
			return "deltaX" in e ? e.deltaX : "wheelDeltaX" in e ? -e.wheelDeltaX : 0;
		},
		deltaY: function(e) {
			return "deltaY" in e ? e.deltaY : "wheelDeltaY" in e ? -e.wheelDeltaY : "wheelDelta" in e ? -e.wheelDelta : 0;
		},
		deltaZ: 0,
		deltaMode: 0
	})), sr = Fn(T({}, In, {
		newState: 0,
		oldState: 0,
		source: 0
	})), cr = [
		9,
		13,
		27,
		32
	], lr = Tn && "CompositionEvent" in window, ur = null;
	Tn && "documentMode" in document && (ur = document.documentMode);
	var dr = Tn && "TextEvent" in window && !ur, fr = Tn && (!lr || ur && 8 < ur && 11 >= ur), pr = " ", mr = !1;
	function hr(e, t) {
		switch (e) {
			case "keyup": return cr.indexOf(t.keyCode) !== -1;
			case "keydown": return t.keyCode !== 229;
			case "keypress":
			case "mousedown":
			case "focusout": return !0;
			default: return !1;
		}
	}
	function gr(e) {
		return e = e.detail, typeof e == "object" && "data" in e ? e.data : null;
	}
	var _r = !1;
	function vr(e, t) {
		switch (e) {
			case "compositionend": return gr(t);
			case "keypress": return t.which === 32 ? (mr = !0, pr) : null;
			case "textInput": return e = t.data, e === pr && mr ? null : e;
			default: return null;
		}
	}
	function yr(e, t) {
		if (_r) return e === "compositionend" || !lr && hr(e, t) ? (e = jn(), An = kn = On = null, _r = !1, e) : null;
		switch (e) {
			case "paste": return null;
			case "keypress":
				if (!(t.ctrlKey || t.altKey || t.metaKey) || t.ctrlKey && t.altKey) {
					if (t.char && 1 < t.char.length) return t.char;
					if (t.which) return String.fromCharCode(t.which);
				}
				return null;
			case "compositionend": return fr && t.locale !== "ko" ? null : t.data;
			default: return null;
		}
	}
	var br = {
		color: !0,
		date: !0,
		datetime: !0,
		"datetime-local": !0,
		email: !0,
		month: !0,
		number: !0,
		password: !0,
		range: !0,
		search: !0,
		tel: !0,
		text: !0,
		time: !0,
		url: !0,
		week: !0
	};
	function H(e) {
		var t = e && e.nodeName && e.nodeName.toLowerCase();
		return t === "input" ? !!br[e.type] : t === "textarea";
	}
	function xr(e, t, n, r) {
		yn ? bn ? bn.push(r) : bn = [r] : yn = r, t = Jf(t, "onChange"), 0 < t.length && (n = new Ln("onChange", "change", null, n, r), e.push({
			event: n,
			listeners: t
		}));
	}
	var Sr = null, Cr = null;
	function wr(e) {
		Vf(e, 0);
	}
	function Tr(e) {
		if (Qt(Nt(e))) return e;
	}
	function Er(e, t) {
		if (e === "change") return t;
	}
	var Dr = !1;
	if (Tn) {
		var Or;
		if (Tn) {
			var kr = "oninput" in document;
			if (!kr) {
				var Ar = document.createElement("div");
				Ar.setAttribute("oninput", "return;"), kr = typeof Ar.oninput == "function";
			}
			Or = kr;
		} else Or = !1;
		Dr = Or && (!document.documentMode || 9 < document.documentMode);
	}
	function jr() {
		Sr && (Sr.detachEvent("onpropertychange", Mr), Cr = Sr = null);
	}
	function Mr(e) {
		if (e.propertyName === "value" && Tr(Cr)) {
			var t = [];
			xr(t, Cr, e, vn(e)), Cn(wr, t);
		}
	}
	function Nr(e, t, n) {
		e === "focusin" ? (jr(), Sr = t, Cr = n, Sr.attachEvent("onpropertychange", Mr)) : e === "focusout" && jr();
	}
	function Pr(e) {
		if (e === "selectionchange" || e === "keyup" || e === "keydown") return Tr(Cr);
	}
	function Fr(e, t) {
		if (e === "click") return Tr(t);
	}
	function Ir(e, t) {
		if (e === "input" || e === "change") return Tr(t);
	}
	function Lr(e, t) {
		return e === t && (e !== 0 || 1 / e == 1 / t) || e !== e && t !== t;
	}
	var Rr = typeof Object.is == "function" ? Object.is : Lr;
	function zr(e, t) {
		if (Rr(e, t)) return !0;
		if (typeof e != "object" || !e || typeof t != "object" || !t) return !1;
		var n = Object.keys(e), r = Object.keys(t);
		if (n.length !== r.length) return !1;
		for (r = 0; r < n.length; r++) {
			var i = n[r];
			if (!ze.call(t, i) || !Rr(e[i], t[i])) return !1;
		}
		return !0;
	}
	function Br(e) {
		if (e ||= typeof document < "u" ? document : void 0, e === void 0) return null;
		try {
			return e.activeElement || e.body;
		} catch {
			return e.body;
		}
	}
	function Vr(e) {
		for (; e && e.firstChild;) e = e.firstChild;
		return e;
	}
	function Hr(e, t) {
		var n = Vr(e);
		e = 0;
		for (var r; n;) {
			if (n.nodeType === 3) {
				if (r = e + n.textContent.length, e <= t && r >= t) return {
					node: n,
					offset: t - e
				};
				e = r;
			}
			a: {
				for (; n;) {
					if (n.nextSibling) {
						n = n.nextSibling;
						break a;
					}
					n = n.parentNode;
				}
				n = void 0;
			}
			n = Vr(n);
		}
	}
	function Ur(e, t) {
		return e && t ? e === t ? !0 : e && e.nodeType === 3 ? !1 : t && t.nodeType === 3 ? Ur(e, t.parentNode) : "contains" in e ? e.contains(t) : e.compareDocumentPosition ? !!(e.compareDocumentPosition(t) & 16) : !1 : !1;
	}
	function Wr(e) {
		e = e != null && e.ownerDocument != null && e.ownerDocument.defaultView != null ? e.ownerDocument.defaultView : window;
		for (var t = Br(e.document); t instanceof e.HTMLIFrameElement;) {
			try {
				var n = typeof t.contentWindow.location.href == "string";
			} catch {
				n = !1;
			}
			if (n) e = t.contentWindow;
			else break;
			t = Br(e.document);
		}
		return t;
	}
	function Gr(e) {
		var t = e && e.nodeName && e.nodeName.toLowerCase();
		return t && (t === "input" && (e.type === "text" || e.type === "search" || e.type === "tel" || e.type === "url" || e.type === "password") || t === "textarea" || e.contentEditable === "true");
	}
	var Kr = Tn && "documentMode" in document && 11 >= document.documentMode, qr = null, Jr = null, Yr = null, Xr = !1;
	function Zr(e, t, n) {
		var r = n.window === n ? n.document : n.nodeType === 9 ? n : n.ownerDocument;
		Xr || qr == null || qr !== Br(r) || (r = qr, "selectionStart" in r && Gr(r) ? r = {
			start: r.selectionStart,
			end: r.selectionEnd
		} : (r = (r.ownerDocument && r.ownerDocument.defaultView || window).getSelection(), r = {
			anchorNode: r.anchorNode,
			anchorOffset: r.anchorOffset,
			focusNode: r.focusNode,
			focusOffset: r.focusOffset
		}), Yr && zr(Yr, r) || (Yr = r, r = Jf(Jr, "onSelect"), 0 < r.length && (t = new Ln("onSelect", "select", null, t, n), e.push({
			event: t,
			listeners: r
		}), t.target = qr)));
	}
	function Qr(e, t) {
		var n = {};
		return n[e.toLowerCase()] = t.toLowerCase(), n["Webkit" + e] = "webkit" + t, n["Moz" + e] = "moz" + t, n;
	}
	var $r = {
		animationend: Qr("Animation", "AnimationEnd"),
		animationiteration: Qr("Animation", "AnimationIteration"),
		animationstart: Qr("Animation", "AnimationStart"),
		transitionrun: Qr("Transition", "TransitionRun"),
		transitionstart: Qr("Transition", "TransitionStart"),
		transitioncancel: Qr("Transition", "TransitionCancel"),
		transitionend: Qr("Transition", "TransitionEnd")
	}, ei = {}, ti = {};
	Tn && (ti = document.createElement("div").style, "AnimationEvent" in window || (delete $r.animationend.animation, delete $r.animationiteration.animation, delete $r.animationstart.animation), "TransitionEvent" in window || delete $r.transitionend.transition);
	function ni(e) {
		if (ei[e]) return ei[e];
		if (!$r[e]) return e;
		var t = $r[e], n;
		for (n in t) if (t.hasOwnProperty(n) && n in ti) return ei[e] = t[n];
		return e;
	}
	var ri = ni("animationend"), ii = ni("animationiteration"), ai = ni("animationstart"), oi = ni("transitionrun"), si = ni("transitionstart"), ci = ni("transitioncancel"), li = ni("transitionend"), ui = /* @__PURE__ */ new Map(), di = "abort auxClick beforeToggle cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error fullscreenChange fullscreenError gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");
	di.push("scrollEnd");
	function fi(e, t) {
		ui.set(e, t), zt(t, [e]);
	}
	var pi = 0;
	function mi(e, t) {
		if (e.name != null && e.name !== "auto") return e.name;
		if (t.autoName !== null) return t.autoName;
		e = bd.identifierPrefix;
		var n = pi++;
		return e = "_" + e + "t_" + n.toString(32) + "_", t.autoName = e;
	}
	function hi(e) {
		if (e == null || typeof e == "string") return e;
		var t = null, n = Od;
		if (n !== null) for (var r = 0; r < n.length; r++) {
			var i = e[n[r]];
			if (i != null) {
				if (i === "none") return "none";
				t = t == null ? i : t + (" " + i);
			}
		}
		return t ?? e.default;
	}
	function gi(e, t) {
		return e = hi(e), t = hi(t), t == null ? e === "auto" ? null : e : t === "auto" ? null : t;
	}
	var _i = typeof reportError == "function" ? reportError : function(e) {
		if (typeof window == "object" && typeof window.ErrorEvent == "function") {
			var t = new window.ErrorEvent("error", {
				bubbles: !0,
				cancelable: !0,
				message: typeof e == "object" && e && typeof e.message == "string" ? String(e.message) : String(e),
				error: e
			});
			if (!window.dispatchEvent(t)) return;
		} else if (typeof process == "object" && typeof process.emit == "function") {
			process.emit("uncaughtException", e);
			return;
		}
		console.error(e);
	}, vi = [], yi = 0, bi = 0;
	function xi() {
		for (var e = yi, t = bi = yi = 0; t < e;) {
			var n = vi[t];
			vi[t++] = null;
			var r = vi[t];
			vi[t++] = null;
			var i = vi[t];
			vi[t++] = null;
			var a = vi[t];
			if (vi[t++] = null, r !== null && i !== null) {
				var o = r.pending;
				o === null ? i.next = i : (i.next = o.next, o.next = i), r.pending = i;
			}
			a !== 0 && Ti(n, i, a);
		}
	}
	function Si(e, t, n, r) {
		vi[yi++] = e, vi[yi++] = t, vi[yi++] = n, vi[yi++] = r, bi |= r, e.lanes |= r, e = e.alternate, e !== null && (e.lanes |= r);
	}
	function Ci(e, t, n, r) {
		return Si(e, t, n, r), Ei(e);
	}
	function wi(e, t) {
		return Si(e, null, null, t), Ei(e);
	}
	function Ti(e, t, n) {
		e.lanes |= n;
		var r = e.alternate;
		r !== null && (r.lanes |= n);
		for (var i = !1, a = e.return; a !== null;) a.childLanes |= n, r = a.alternate, r !== null && (r.childLanes |= n), a.tag === 22 && (e = a.stateNode, e === null || e._visibility & 1 || (i = !0)), e = a, a = a.return;
		return e.tag === 3 ? (a = e.stateNode, i && t !== null && (i = 31 - tt(n), e = a.hiddenUpdates, r = e[i], r === null ? e[i] = [t] : r.push(t), t.lane = n | 536870912), a) : null;
	}
	function Ei(e) {
		if (50 < kd) throw kd = 0, Ad = null, Error(s(185));
		for (var t = e.return; t !== null;) e = t, t = e.return;
		return e.tag === 3 ? e.stateNode : null;
	}
	var Di = {};
	function Oi(e, t, n, r) {
		this.tag = e, this.key = n, this.sibling = this.child = this.return = this.stateNode = this.type = this.elementType = null, this.index = 0, this.refCleanup = this.ref = null, this.pendingProps = t, this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null, this.mode = r, this.subtreeFlags = this.flags = 0, this.deletions = null, this.childLanes = this.lanes = 0, this.alternate = null;
	}
	function ki(e, t, n, r) {
		return new Oi(e, t, n, r);
	}
	function Ai(e) {
		return e = e.prototype, !(!e || !e.isReactComponent);
	}
	function ji(e, t) {
		var n = e.alternate;
		return n === null ? (n = ki(e.tag, t, e.key, e.mode), n.elementType = e.elementType, n.type = e.type, n.stateNode = e.stateNode, n.alternate = e, e.alternate = n) : (n.pendingProps = t, n.type = e.type, n.flags = 0, n.subtreeFlags = 0, n.deletions = null), n.flags = e.flags & 1206910976, n.childLanes = e.childLanes, n.lanes = e.lanes, n.child = e.child, n.memoizedProps = e.memoizedProps, n.memoizedState = e.memoizedState, n.updateQueue = e.updateQueue, t = e.dependencies, n.dependencies = t === null ? null : {
			lanes: t.lanes,
			firstContext: t.firstContext
		}, n.sibling = e.sibling, n.index = e.index, n.ref = e.ref, n.refCleanup = e.refCleanup, n;
	}
	function Mi(e, t) {
		e.flags &= 1206910978;
		var n = e.alternate;
		return n === null ? (e.childLanes = 0, e.lanes = t, e.child = null, e.subtreeFlags = 0, e.memoizedProps = null, e.memoizedState = null, e.updateQueue = null, e.dependencies = null, e.stateNode = null) : (e.childLanes = n.childLanes, e.lanes = n.lanes, e.child = n.child, e.subtreeFlags = 0, e.deletions = null, e.memoizedProps = n.memoizedProps, e.memoizedState = n.memoizedState, e.updateQueue = n.updateQueue, e.type = n.type, t = n.dependencies, e.dependencies = t === null ? null : {
			lanes: t.lanes,
			firstContext: t.firstContext
		}), e;
	}
	function Ni(e, t, n, r, i, a) {
		var o = 0;
		if (r = e, typeof r == "function") Ai(r) && (o = 1);
		else if (typeof r == "string") o = qm(e, n, Ee.current) ? 26 : e === "html" || e === "head" || e === "body" ? 27 : 5;
		else a: switch (r) {
			case fe: return e = ki(31, n, t, i), e.elementType = fe, e.lanes = a, e;
			case E: return Pi(n.children, i, a, t);
			case ae:
				o = 8, i |= 24;
				break;
			case oe: return e = ki(12, n, t, i | 2), e.elementType = oe, e.lanes = a, e;
			case D: return e = ki(13, n, t, i), e.elementType = D, e.lanes = a, e;
			case ue: return e = ki(19, n, t, i), e.elementType = ue, e.lanes = a, e;
			case pe:
			case he: return e = i | 32, e = ki(30, n, t, e), e.elementType = he, e.lanes = a, e.stateNode = {
				autoName: null,
				paired: null,
				clones: null,
				ref: null
			}, e;
			default:
				if (typeof r == "object" && r) switch (r.$$typeof) {
					case ce:
						o = 10;
						break a;
					case se:
						o = 9;
						break a;
					case le:
						o = 11;
						break a;
					case de:
						o = 14;
						break a;
					case O:
						o = 16, r = null;
						break a;
				}
				o = 29, n = Error(s(130, e === null ? "null" : typeof e, "")), r = null;
		}
		return t = ki(o, n, t, i), t.elementType = e, t.type = r, t.lanes = a, t;
	}
	function Pi(e, t, n, r) {
		return e = ki(7, e, r, t), e.lanes = n, e;
	}
	function Fi(e, t, n) {
		return e = ki(6, e, null, t), e.lanes = n, e;
	}
	function Ii(e) {
		var t = ki(18, null, null, 0);
		return t.stateNode = e, t;
	}
	function Li(e, t, n) {
		return t = ki(4, e.children === null ? [] : e.children, e.key, t), t.lanes = n, t.stateNode = {
			containerInfo: e.containerInfo,
			pendingChildren: null,
			implementation: e.implementation
		}, t;
	}
	var Ri = /* @__PURE__ */ new WeakMap();
	function zi(e, t) {
		if (typeof e == "object" && e) {
			var n = Ri.get(e);
			return n === void 0 ? (t = {
				value: e,
				source: t,
				stack: Re(t)
			}, Ri.set(e, t), t) : n;
		}
		return {
			value: e,
			source: t,
			stack: Re(t)
		};
	}
	var Bi = [], Vi = 0, Hi = null, Ui = 0, Wi = [], Gi = 0, Ki = null, qi = 1, Ji = "";
	function Yi(e, t) {
		Bi[Vi++] = Ui, Bi[Vi++] = Hi, Hi = e, Ui = t;
	}
	function Xi(e, t, n) {
		Wi[Gi++] = qi, Wi[Gi++] = Ji, Wi[Gi++] = Ki, Ki = e;
		var r = qi;
		e = Ji;
		var i = 32 - tt(r) - 1;
		r &= ~(1 << i), n += 1;
		var a = 32 - tt(t) + i;
		if (30 < a) {
			var o = i - i % 5;
			a = (r & (1 << o) - 1).toString(32), r >>= o, i -= o, qi = 1 << 32 - tt(t) + i | n << i | r, Ji = a + e;
		} else qi = 1 << a | n << i | r, Ji = e;
	}
	function Zi(e) {
		e.return !== null && (Yi(e, 1), Xi(e, 1, 0));
	}
	function Qi(e) {
		for (; e === Hi;) Hi = Bi[--Vi], Bi[Vi] = null, Ui = Bi[--Vi], Bi[Vi] = null;
		for (; e === Ki;) Ki = Wi[--Gi], Wi[Gi] = null, Ji = Wi[--Gi], Wi[Gi] = null, qi = Wi[--Gi], Wi[Gi] = null;
	}
	function $i(e, t) {
		Wi[Gi++] = qi, Wi[Gi++] = Ji, Wi[Gi++] = Ki, qi = t.id, Ji = t.overflow, Ki = e;
	}
	var ea = null, ta = null, U = !1, na = null, ra = !1, ia = Error(s(519));
	function aa(e) {
		throw da(zi(Error(s(418, 1 < arguments.length && arguments[1] !== void 0 && arguments[1] ? "text" : "HTML", "")), e)), ia;
	}
	function oa(e) {
		var t = e.stateNode, n = e.type, r = e.memoizedProps;
		switch (t[R] = e, t[z] = r, n) {
			case "dialog":
				Q("cancel", t), Q("close", t);
				break;
			case "iframe":
			case "object":
			case "embed":
				Q("load", t);
				break;
			case "video":
			case "audio":
				for (n = 0; n < zf.length; n++) Q(zf[n], t);
				break;
			case "source":
				Q("error", t);
				break;
			case "img":
			case "image":
			case "link":
				Q("error", t), Q("load", t);
				break;
			case "details":
				Q("toggle", t);
				break;
			case "input":
				Q("invalid", t), nn(t, r.value, r.defaultValue, r.checked, r.defaultChecked, r.type, r.name, !0);
				break;
			case "select":
				Q("invalid", t);
				break;
			case "textarea": Q("invalid", t), sn(t, r.value, r.defaultValue, r.children);
		}
		n = r.children, typeof n != "string" && typeof n != "number" && typeof n != "bigint" || t.textContent === "" + n || !0 === r.suppressHydrationWarning || ep(t.textContent, n) ? (r.popover != null && (Q("beforetoggle", t), Q("toggle", t)), r.onScroll != null && Q("scroll", t), r.onScrollEnd != null && Q("scrollend", t), r.onClick != null && (t.onclick = gn), t = !0) : t = !1, t || aa(e, !0);
	}
	function sa(e) {
		for (ea = e.return; ea;) switch (ea.tag) {
			case 5:
			case 31:
			case 13:
				ra = !1;
				return;
			case 27:
			case 3:
				ra = !0;
				return;
			default: ea = ea.return;
		}
	}
	function ca(e) {
		if (e !== ea) return !1;
		if (!U) return sa(e), U = !0, !1;
		var t = e.tag, n;
		if ((n = t !== 3 && t !== 27) && ((n = t === 5) && (n = e.type, n = n === "form" || n === "button" || pp(e.type, e.memoizedProps)), n = !n), n && ta && aa(e), sa(e), t === 13) {
			if (e = e.memoizedState, e = e === null ? null : e.dehydrated, !e) throw Error(s(317));
			ta = dm(e);
		} else if (t === 31) {
			if (e = e.memoizedState, e = e === null ? null : e.dehydrated, !e) throw Error(s(317));
			ta = dm(e);
		} else t === 27 ? (t = ta, Sp(e.type) ? (e = um, um = null, ta = e) : ta = t) : ta = ea ? lm(e.stateNode.nextSibling) : null;
		return !0;
	}
	function la() {
		ta = ea = null, U = !1;
	}
	function ua() {
		var e = na;
		return e !== null && (fd === null ? fd = e : fd.push.apply(fd, e), na = null), e;
	}
	function da(e) {
		na === null ? na = [e] : na.push(e);
	}
	var fa = we(null), pa = null, ma = null;
	function ha(e, t, n) {
		M(fa, t._currentValue), t._currentValue = n;
	}
	function ga(e) {
		e._currentValue = fa.current, Te(fa);
	}
	function _a(e, t, n) {
		for (; e !== null;) {
			var r = e.alternate;
			if ((e.childLanes & t) === t ? r !== null && (r.childLanes & t) !== t && (r.childLanes |= t) : (e.childLanes |= t, r !== null && (r.childLanes |= t)), e === n) break;
			e = e.return;
		}
	}
	function va(e, t, n, r) {
		var i = e.child;
		for (i !== null && (i.return = e); i !== null;) {
			var a = i.dependencies;
			if (a !== null) {
				var o = i.child;
				a = a.firstContext;
				a: for (; a !== null;) {
					var c = a;
					a = i;
					for (var l = 0; l < t.length; l++) if (c.context === t[l]) {
						a.lanes |= n, c = a.alternate, c !== null && (c.lanes |= n), _a(a.return, n, e), r || (o = null);
						break a;
					}
					a = c.next;
				}
			} else if (i.tag === 18) {
				if (o = i.return, o === null) throw Error(s(341));
				o.lanes |= n, a = o.alternate, a !== null && (a.lanes |= n), _a(o, n, e), o = null;
			} else i.tag === 13 && i.memoizedState !== null && i.memoizedState.dehydrated === null ? (i.lanes |= n, o = i.alternate, o !== null && (o.lanes |= n), _a(i.return, n, e), o = i.child, o = o === null ? null : o.sibling) : o = i.child;
			if (o !== null) o.return = i;
			else for (o = i; o !== null;) {
				if (o === e) {
					o = null;
					break;
				}
				if (i = o.sibling, i !== null) {
					i.return = o.return, o = i;
					break;
				}
				o = o.return;
			}
			i = o;
		}
	}
	function ya(e, t, n, r) {
		e = null;
		for (var i = t, a = !1; i !== null;) {
			if (!a) {
				if (i.flags & 524288) a = !0;
				else if (i.flags & 262144) break;
			}
			if (i.tag === 10) {
				var o = i.alternate;
				if (o === null) throw Error(s(387));
				if (o = o.memoizedProps, o !== null) {
					var c = i.type;
					Rr(i.pendingProps.value, o.value) || (e === null ? e = [c] : e.push(c));
				}
			} else if (i === ke.current) {
				if (o = i.alternate, o === null) throw Error(s(387));
				o.memoizedState.memoizedState !== i.memoizedState.memoizedState && (e === null ? e = [sh] : e.push(sh));
			}
			i = i.return;
		}
		return e !== null && va(t, e, n, r), t.flags |= 262144, e !== null;
	}
	function ba(e) {
		for (e = e.firstContext; e !== null;) {
			if (!Rr(e.context._currentValue, e.memoizedValue)) return !0;
			e = e.next;
		}
		return !1;
	}
	function xa(e) {
		pa = e, ma = null, e = e.dependencies, e !== null && (e.firstContext = null);
	}
	function Sa(e) {
		return wa(pa, e);
	}
	function Ca(e, t) {
		return pa === null && xa(e), wa(e, t);
	}
	function wa(e, t) {
		var n = t._currentValue;
		if (t = {
			context: t,
			memoizedValue: n,
			next: null
		}, ma === null) {
			if (e === null) throw Error(s(308));
			ma = t, e.dependencies = {
				lanes: 0,
				firstContext: t
			}, e.flags |= 524288;
		} else ma = ma.next = t;
		return n;
	}
	var Ta = typeof AbortController < "u" ? AbortController : function() {
		var e = [], t = this.signal = {
			aborted: !1,
			addEventListener: function(t, n) {
				e.push(n);
			}
		};
		this.abort = function() {
			t.aborted = !0, e.forEach(function(e) {
				return e();
			});
		};
	}, Ea = t.unstable_scheduleCallback, Da = t.unstable_NormalPriority, Oa = {
		$$typeof: ce,
		Consumer: null,
		Provider: null,
		_currentValue: null,
		_currentValue2: null,
		_threadCount: 0
	};
	function ka() {
		return {
			controller: new Ta(),
			data: /* @__PURE__ */ new Map(),
			refCount: 0
		};
	}
	function Aa(e) {
		e.refCount--, e.refCount === 0 && Ea(Da, function() {
			e.controller.abort();
		});
	}
	function ja(e, t) {
		if (e.pendingLanes & 4194048) {
			var n = e.transitionTypes;
			for (n === null && (n = e.transitionTypes = []), e = 0; e < t.length; e++) {
				var r = t[e];
				n.indexOf(r) === -1 && n.push(r);
			}
		}
	}
	var Ma = null;
	function Na(e) {
		var t = e.transitionTypes;
		return e.transitionTypes = null, t;
	}
	var Pa = null, Fa = 0, Ia = 0, La = null;
	function Ra(e, t) {
		if (Pa === null) {
			var n = Pa = [];
			Fa = 0, Ia = Pf(), La = {
				status: "pending",
				value: void 0,
				then: function(e) {
					n.push(e);
				}
			};
		}
		return Fa++, t.then(za, za), t;
	}
	function za() {
		if (--Fa === 0 && (Ma = null, Pa !== null)) {
			La !== null && (La.status = "fulfilled");
			var e = Pa;
			Pa = null, Ia = 0, La = null;
			for (var t = 0; t < e.length; t++) (0, e[t])();
		}
	}
	function Ba(e, t) {
		var n = [], r = {
			status: "pending",
			value: null,
			reason: null,
			then: function(e) {
				n.push(e);
			}
		};
		return e.then(function() {
			r.status = "fulfilled", r.value = t;
			for (var e = 0; e < n.length; e++) (0, n[e])(t);
		}, function(e) {
			for (r.status = "rejected", r.reason = e, e = 0; e < n.length; e++) (0, n[e])(void 0);
		}), r;
	}
	var Va = k.S;
	k.S = function(e, t) {
		if (hd = We(), typeof t == "object" && t && typeof t.then == "function" && Ra(e, t), Ma !== null) for (var n = bf; n !== null;) ja(n, Ma), n = n.next;
		if (n = e.types, n !== null) {
			for (var r = bf; r !== null;) ja(r, n), r = r.next;
			if (Ia !== 0) {
				r = Ma, r === null && (r = Ma = []);
				for (var i = 0; i < n.length; i++) {
					var a = n[i];
					r.indexOf(a) === -1 && r.push(a);
				}
			}
		}
		Va !== null && Va(e, t);
	};
	var Ha = we(null);
	function Ua() {
		var e = Ha.current;
		return e === null ? $u.pooledCache : e;
	}
	function Wa(e, t) {
		t === null ? M(Ha, Ha.current) : M(Ha, t.pool);
	}
	function Ga() {
		var e = Ua();
		return e === null ? null : {
			parent: Oa._currentValue,
			pool: e
		};
	}
	var Ka = Error(s(460)), qa = Error(s(474)), Ja = Error(s(542)), Ya = { then: function() {} };
	function Xa(e) {
		return e = e.status, e === "fulfilled" || e === "rejected";
	}
	function Za(e, t, n) {
		switch (n = e[n], n === void 0 ? e.push(t) : n !== t && (t.then(gn, gn), t = n), t.status) {
			case "fulfilled": return t.value;
			case "rejected": throw e = t.reason, to(e), e === void 0 && !("reason" in t) ? Error(s(600)) : e;
			default:
				if (typeof t.status == "string") t.then(gn, gn);
				else {
					if (e = $u, e !== null && 100 < e.shellSuspendCounter) throw Error(s(482));
					e = t, e.status = "pending", e.then(function(e) {
						if (t.status === "pending") {
							var n = t;
							n.status = "fulfilled", n.value = e;
						}
					}, function(e) {
						if (t.status === "pending") {
							var n = t;
							n.status = "rejected", n.reason = e;
						}
					});
				}
				switch (t.status) {
					case "fulfilled": return t.value;
					case "rejected": throw e = t.reason, to(e), e;
				}
				throw $a = t, Ka;
		}
	}
	function Qa(e) {
		try {
			var t = e._init;
			return t(e._payload);
		} catch (e) {
			throw typeof e == "object" && e && typeof e.then == "function" ? ($a = e, Ka) : e;
		}
	}
	var $a = null;
	function eo() {
		if ($a === null) throw Error(s(459));
		var e = $a;
		return $a = null, e;
	}
	function to(e) {
		if (e === Ka || e === Ja) throw Error(s(483));
	}
	var no = null, ro = 0;
	function io(e) {
		var t = ro;
		return ro += 1, no === null && (no = []), Za(no, e, t);
	}
	function ao(e, t) {
		t = t.props.ref, e.ref = t === void 0 ? null : t;
	}
	function oo(e, t) {
		throw t.$$typeof === ne ? Error(s(525)) : (e = Object.prototype.toString.call(t), Error(s(31, e === "[object Object]" ? "object with keys {" + Object.keys(t).join(", ") + "}" : e)));
	}
	function so(e) {
		function t(t, n) {
			if (e) {
				var r = t.deletions;
				r === null ? (t.deletions = [n], t.flags |= 16) : r.push(n);
			}
		}
		function n(n, r) {
			if (!e) return null;
			for (; r !== null;) t(n, r), r = r.sibling;
			return null;
		}
		function r(e) {
			for (var t = /* @__PURE__ */ new Map(); e !== null;) e.key === null ? t.set(e.index, e) : t.set(e.key, e), e = e.sibling;
			return t;
		}
		function i(e, t) {
			return e = ji(e, t), e.index = 0, e.sibling = null, e;
		}
		function a(t, n, r) {
			return t.index = r, e ? (r = t.alternate, r === null ? (t.flags |= 134217730, n) : (r = r.index, r < n ? (t.flags |= 2, n) : r)) : (t.flags |= 1048576, n);
		}
		function o(t) {
			return e && t.alternate === null && (t.flags |= 134217730), t;
		}
		function c(e, t, n, r) {
			return t === null || t.tag !== 6 ? (t = Fi(n, e.mode, r), t.return = e, t) : (t = i(t, n), t.return = e, t);
		}
		function l(e, t, n, r) {
			var a = n.type;
			return a === E ? (e = d(e, t, n.props.children, r, n.key), ao(e, n), e) : t !== null && (t.elementType === a || typeof a == "object" && a && a.$$typeof === O && Qa(a) === t.type) ? (t = i(t, n.props), ao(t, n), t.return = e, t) : (t = Ni(n.type, n.key, n.props, null, e.mode, r), ao(t, n), t.return = e, t);
		}
		function u(e, t, n, r) {
			return t === null || t.tag !== 4 || t.stateNode.containerInfo !== n.containerInfo || t.stateNode.implementation !== n.implementation ? (t = Li(n, e.mode, r), t.return = e, t) : (t = i(t, n.children || []), t.return = e, t);
		}
		function d(e, t, n, r, a) {
			return t === null || t.tag !== 7 ? (t = Pi(n, e.mode, r, a), t.return = e, t) : (t = i(t, n), t.return = e, t);
		}
		function f(e, t, n) {
			if (typeof t == "string" && t !== "" || typeof t == "number" || typeof t == "bigint") return t = Fi("" + t, e.mode, n), t.return = e, t;
			if (typeof t == "object" && t) {
				switch (t.$$typeof) {
					case re: return n = Ni(t.type, t.key, t.props, null, e.mode, n), ao(n, t), n.return = e, n;
					case ie: return t = Li(t, e.mode, n), t.return = e, t;
					case O: return t = Qa(t), f(e, t, n);
				}
				if (xe(t) || ve(t)) return t = Pi(t, e.mode, n, null), t.return = e, t;
				if (typeof t.then == "function") return f(e, io(t), n);
				if (t.$$typeof === ce) return f(e, Ca(e, t), n);
				oo(e, t);
			}
			return null;
		}
		function p(e, t, n, r) {
			var i = t === null ? null : t.key;
			if (typeof n == "string" && n !== "" || typeof n == "number" || typeof n == "bigint") return i === null ? c(e, t, "" + n, r) : null;
			if (typeof n == "object" && n) {
				switch (n.$$typeof) {
					case re: return n.key === i ? l(e, t, n, r) : null;
					case ie: return n.key === i ? u(e, t, n, r) : null;
					case O: return n = Qa(n), p(e, t, n, r);
				}
				if (xe(n) || ve(n)) return i === null ? d(e, t, n, r, null) : null;
				if (typeof n.then == "function") return p(e, t, io(n), r);
				if (n.$$typeof === ce) return p(e, t, Ca(e, n), r);
				oo(e, n);
			}
			return null;
		}
		function m(e, t, n, r, i) {
			if (typeof r == "string" && r !== "" || typeof r == "number" || typeof r == "bigint") return e = e.get(n) || null, c(t, e, "" + r, i);
			if (typeof r == "object" && r) {
				switch (r.$$typeof) {
					case re: return e = e.get(r.key === null ? n : r.key) || null, l(t, e, r, i);
					case ie: return e = e.get(r.key === null ? n : r.key) || null, u(t, e, r, i);
					case O: return r = Qa(r), m(e, t, n, r, i);
				}
				if (xe(r) || ve(r)) return e = e.get(n) || null, d(t, e, r, i, null);
				if (typeof r.then == "function") return m(e, t, n, io(r), i);
				if (r.$$typeof === ce) return m(e, t, n, Ca(t, r), i);
				oo(t, r);
			}
			return null;
		}
		function h(i, o, s, c) {
			for (var l = null, u = null, d = o, h = o = 0, g = null; d !== null && h < s.length; h++) {
				d.index > h ? (g = d, d = null) : g = d.sibling;
				var _ = p(i, d, s[h], c);
				if (_ === null) {
					d === null && (d = g);
					break;
				}
				e && d && _.alternate === null && t(i, d), o = a(_, o, h), u === null ? l = _ : u.sibling = _, u = _, d = g;
			}
			if (h === s.length) return n(i, d), U && Yi(i, h), l;
			if (d === null) {
				for (; h < s.length; h++) d = f(i, s[h], c), d !== null && (o = a(d, o, h), u === null ? l = d : u.sibling = d, u = d);
				return U && Yi(i, h), l;
			}
			for (d = r(d); h < s.length; h++) g = m(d, i, h, s[h], c), g !== null && (e && (_ = g.alternate, _ !== null && d.delete(_.key === null ? h : _.key)), o = a(g, o, h), u === null ? l = g : u.sibling = g, u = g);
			return e && d.forEach(function(e) {
				return t(i, e);
			}), U && Yi(i, h), l;
		}
		function g(i, o, c, l) {
			if (c == null) throw Error(s(151));
			for (var u = null, d = null, h = o, g = o = 0, _ = null, v = c.next(); h !== null && !v.done; g++, v = c.next()) {
				h.index > g ? (_ = h, h = null) : _ = h.sibling;
				var y = p(i, h, v.value, l);
				if (y === null) {
					h === null && (h = _);
					break;
				}
				e && h && y.alternate === null && t(i, h), o = a(y, o, g), d === null ? u = y : d.sibling = y, d = y, h = _;
			}
			if (v.done) return n(i, h), U && Yi(i, g), u;
			if (h === null) {
				for (; !v.done; g++, v = c.next()) v = f(i, v.value, l), v !== null && (o = a(v, o, g), d === null ? u = v : d.sibling = v, d = v);
				return U && Yi(i, g), u;
			}
			for (h = r(h); !v.done; g++, v = c.next()) v = m(h, i, g, v.value, l), v !== null && (e && (_ = v.alternate, _ !== null && h.delete(_.key === null ? g : _.key)), o = a(v, o, g), d === null ? u = v : d.sibling = v, d = v);
			return e && h.forEach(function(e) {
				return t(i, e);
			}), U && Yi(i, g), u;
		}
		function _(e, r, a, c) {
			if (typeof a == "object" && a && a.type === E && a.key === null && a.props.ref === void 0 && (a = a.props.children), typeof a == "object" && a) {
				switch (a.$$typeof) {
					case re:
						a: {
							for (var l = a.key; r !== null;) {
								if (r.key === l) {
									if (l = a.type, l === E) {
										if (r.tag === 7) {
											n(e, r.sibling), c = i(r, a.props.children), ao(c, a), c.return = e, e = c;
											break a;
										}
									} else if (r.elementType === l || typeof l == "object" && l && l.$$typeof === O && Qa(l) === r.type) {
										n(e, r.sibling), c = i(r, a.props), ao(c, a), c.return = e, e = c;
										break a;
									}
									n(e, r);
									break;
								}
								t(e, r), r = r.sibling;
							}
							a.type === E ? (c = Pi(a.props.children, e.mode, c, a.key), ao(c, a), c.return = e, e = c) : (c = Ni(a.type, a.key, a.props, null, e.mode, c), ao(c, a), c.return = e, e = c);
						}
						return o(e);
					case ie:
						a: {
							for (l = a.key; r !== null;) {
								if (r.key === l) {
									if (r.tag === 4 && r.stateNode.containerInfo === a.containerInfo && r.stateNode.implementation === a.implementation) {
										n(e, r.sibling), c = i(r, a.children || []), c.return = e, e = c;
										break a;
									}
									n(e, r);
									break;
								}
								t(e, r), r = r.sibling;
							}
							c = Li(a, e.mode, c), c.return = e, e = c;
						}
						return o(e);
					case O: return a = Qa(a), _(e, r, a, c);
				}
				if (xe(a)) return h(e, r, a, c);
				if (ve(a)) {
					if (l = ve(a), typeof l != "function") throw Error(s(150));
					return a = l.call(a), g(e, r, a, c);
				}
				if (typeof a.then == "function") return _(e, r, io(a), c);
				if (a.$$typeof === ce) return _(e, r, Ca(e, a), c);
				oo(e, a);
			}
			return typeof a == "string" && a !== "" || typeof a == "number" || typeof a == "bigint" ? (a = "" + a, r !== null && r.tag === 6 ? (n(e, r.sibling), c = i(r, a), c.return = e, e = c) : (n(e, r), c = Fi(a, e.mode, c), c.return = e, e = c), o(e)) : n(e, r);
		}
		return function(e, t, n, r) {
			try {
				ro = 0;
				var i = _(e, t, n, r);
				return no = null, i;
			} catch (t) {
				if (t === Ka || t === Ja) throw t;
				var a = ki(29, t, null, e.mode);
				return a.lanes = r, a.return = e, a;
			}
		};
	}
	var co = so(!0), lo = so(!1), uo = !1;
	function fo(e) {
		e.updateQueue = {
			baseState: e.memoizedState,
			firstBaseUpdate: null,
			lastBaseUpdate: null,
			shared: {
				pending: null,
				lanes: 0,
				hiddenCallbacks: null
			},
			callbacks: null
		};
	}
	function po(e, t) {
		e = e.updateQueue, t.updateQueue === e && (t.updateQueue = {
			baseState: e.baseState,
			firstBaseUpdate: e.firstBaseUpdate,
			lastBaseUpdate: e.lastBaseUpdate,
			shared: e.shared,
			callbacks: null
		});
	}
	function mo(e) {
		return {
			lane: e,
			tag: 0,
			payload: null,
			callback: null,
			next: null
		};
	}
	function ho(e, t, n) {
		var r = e.updateQueue;
		if (r === null) return null;
		if (r = r.shared, q & 2) {
			var i = r.pending;
			return i === null ? t.next = t : (t.next = i.next, i.next = t), r.pending = t, t = Ei(e), Ti(e, null, n), t;
		}
		return Si(e, r, t, n), Ei(e);
	}
	function go(e, t, n) {
		if (t = t.updateQueue, t !== null && (t = t.shared, n & 4194048)) {
			var r = t.lanes;
			r &= e.pendingLanes, n |= r, t.lanes = n, vt(e, n);
		}
	}
	function _o(e, t) {
		var n = e.updateQueue, r = e.alternate;
		if (r !== null && (r = r.updateQueue, n === r)) {
			var i = null, a = null;
			if (n = n.firstBaseUpdate, n !== null) {
				do {
					var o = {
						lane: n.lane,
						tag: n.tag,
						payload: n.payload,
						callback: null,
						next: null
					};
					a === null ? i = a = o : a = a.next = o, n = n.next;
				} while (n !== null);
				a === null ? i = a = t : a = a.next = t;
			} else i = a = t;
			n = {
				baseState: r.baseState,
				firstBaseUpdate: i,
				lastBaseUpdate: a,
				shared: r.shared,
				callbacks: r.callbacks
			}, e.updateQueue = n;
		} else e = n.lastBaseUpdate, e === null ? n.firstBaseUpdate = t : e.next = t, n.lastBaseUpdate = t;
	}
	var vo = !1;
	function yo() {
		if (vo) {
			var e = La;
			if (e !== null) throw e;
		}
	}
	function bo(e, t, n, r) {
		vo = !1;
		var i = e.updateQueue;
		uo = !1;
		var a = i.firstBaseUpdate, o = i.lastBaseUpdate, s = i.shared.pending;
		if (s !== null) {
			i.shared.pending = null;
			var c = s, l = c.next;
			c.next = null, o === null ? a = l : o.next = l, o = c;
			var u = e.alternate;
			u !== null && (u = u.updateQueue, s = u.lastBaseUpdate, s !== o && (s === null ? u.firstBaseUpdate = l : s.next = l, u.lastBaseUpdate = c));
		}
		if (a !== null) {
			var d = i.baseState;
			o = 0, u = l = c = null, s = a;
			do {
				var f = s.lane & -536870913, p = f !== s.lane;
				if (p ? (Y & f) === f : (r & f) === f) {
					f !== 0 && f === Ia && (vo = !0), u !== null && (u = u.next = {
						lane: 0,
						tag: s.tag,
						payload: s.payload,
						callback: null,
						next: null
					});
					a: {
						var m = e, h = s;
						f = t;
						var g = n;
						switch (h.tag) {
							case 1:
								if (m = h.payload, typeof m == "function") {
									d = m.call(g, d, f);
									break a;
								}
								d = m;
								break a;
							case 3: m.flags = m.flags & -65537 | 128;
							case 0:
								if (m = h.payload, f = typeof m == "function" ? m.call(g, d, f) : m, f == null) break a;
								d = T({}, d, f);
								break a;
							case 2: uo = !0;
						}
					}
					f = s.callback, f !== null && (e.flags |= 64, p && (e.flags |= 8192), p = i.callbacks, p === null ? i.callbacks = [f] : p.push(f));
				} else p = {
					lane: f,
					tag: s.tag,
					payload: s.payload,
					callback: s.callback,
					next: null
				}, u === null ? (l = u = p, c = d) : u = u.next = p, o |= f;
				if (s = s.next, s === null) {
					if (s = i.shared.pending, s === null) break;
					p = s, s = p.next, p.next = null, i.lastBaseUpdate = p, i.shared.pending = null;
				}
			} while (1);
			u === null && (c = d), i.baseState = c, i.firstBaseUpdate = l, i.lastBaseUpdate = u, a === null && (i.shared.lanes = 0), od |= o, e.lanes = o, e.memoizedState = d;
		}
	}
	function xo(e, t) {
		if (typeof e != "function") throw Error(s(191, e));
		e.call(t);
	}
	function So(e, t) {
		var n = e.callbacks;
		if (n !== null) for (e.callbacks = null, e = 0; e < n.length; e++) xo(n[e], t);
	}
	var Co = we(null), wo = we(0);
	function To(e, t) {
		e = id, M(wo, e), M(Co, t), id = e | t.baseLanes;
	}
	function Eo() {
		M(wo, id), M(Co, Co.current);
	}
	function Do() {
		id = wo.current, Te(Co), Te(wo);
	}
	var Oo = we(null), ko = null;
	function Ao(e) {
		var t = e.alternate;
		M(Fo, Fo.current & 1), M(Oo, e), ko === null && (t === null || Co.current !== null || t.memoizedState !== null) && (ko = e);
	}
	function jo(e) {
		M(Fo, Fo.current), M(Oo, e), ko === null && (ko = e);
	}
	function Mo(e) {
		e.tag === 22 ? (M(Fo, Fo.current), M(Oo, e), ko === null && (ko = e)) : No();
	}
	function No() {
		M(Fo, Fo.current), M(Oo, Oo.current);
	}
	function Po(e) {
		Te(Oo), ko === e && (ko = null), Te(Fo);
	}
	var Fo = we(0);
	function Io(e, t) {
		M(Oo, Oo.current), M(Fo, t);
	}
	function Lo(e) {
		Te(Fo), Te(Oo), ko === e && (ko = null);
	}
	function Ro(e) {
		for (var t = e; t !== null;) {
			if (t.tag === 13) {
				var n = t.memoizedState;
				if (n !== null && (n = n.dehydrated, n === null || om(n) || sm(n))) return t;
			} else if (t.tag === 19 && t.memoizedProps.revealOrder !== "independent") {
				if (t.flags & 128) return t;
			} else if (t.child !== null) {
				t.child.return = t, t = t.child;
				continue;
			}
			if (t === e) break;
			for (; t.sibling === null;) {
				if (t.return === null || t.return === e) return null;
				t = t.return;
			}
			t.sibling.return = t.return, t = t.sibling;
		}
		return null;
	}
	var zo = 0, W = null, G = null, Bo = null, Vo = !1, Ho = !1, Uo = !1, Wo = 0, Go = 0, Ko = null, qo = 0;
	function Jo() {
		throw Error(s(321));
	}
	function Yo(e, t) {
		if (t === null) return !1;
		for (var n = 0; n < t.length && n < e.length; n++) if (!Rr(e[n], t[n])) return !1;
		return !0;
	}
	function Xo(e, t, n, r, i, a) {
		return zo = a, W = t, t.memoizedState = null, t.updateQueue = null, t.lanes = 0, k.H = e === null || e.memoizedState === null ? pc : mc, Uo = !1, a = n(r, i), Uo = !1, Ho && (a = Qo(t, n, r, i)), Zo(e), a;
	}
	function Zo(e) {
		k.H = fc;
		var t = G !== null && G.next !== null;
		if (zo = 0, Bo = G = W = null, Vo = !1, Go = 0, Ko = null, t) throw Error(s(300));
		e === null || jc || (e = e.dependencies, e !== null && ba(e) && (jc = !0));
	}
	function Qo(e, t, n, r) {
		W = e;
		var i = 0;
		do {
			if (Ho && (Ko = null), Go = 0, Ho = !1, 25 <= i) throw Error(s(301));
			if (i += 1, Bo = G = null, e.updateQueue != null) {
				var a = e.updateQueue;
				a.lastEffect = null, a.events = null, a.stores = null, a.memoCache != null && (a.memoCache.index = 0);
			}
			k.H = hc, a = t(n, r);
		} while (Ho);
		return a;
	}
	function $o() {
		var e = k.H, t = e.useState()[0];
		return t = typeof t.then == "function" ? os(t) : t, e = e.useState()[0], (G === null ? null : G.memoizedState) !== e && (W.flags |= 1024), t;
	}
	function es() {
		var e = Wo !== 0;
		return Wo = 0, e;
	}
	function ts(e, t, n) {
		t.updateQueue = e.updateQueue, t.flags &= -2053, e.lanes &= ~n;
	}
	function ns(e) {
		if (Vo) {
			for (e = e.memoizedState; e !== null;) {
				var t = e.queue;
				t !== null && (t.pending = null), e = e.next;
			}
			Vo = !1;
		}
		zo = 0, Bo = G = W = null, Ho = !1, Go = Wo = 0, Ko = null;
	}
	function rs() {
		var e = {
			memoizedState: null,
			baseState: null,
			baseQueue: null,
			queue: null,
			next: null
		};
		return Bo === null ? W.memoizedState = Bo = e : Bo = Bo.next = e, Bo;
	}
	function is() {
		if (G === null) {
			var e = W.alternate;
			e = e === null ? null : e.memoizedState;
		} else e = G.next;
		var t = Bo === null ? W.memoizedState : Bo.next;
		if (t !== null) Bo = t, G = e;
		else {
			if (e === null) throw W.alternate === null ? Error(s(467)) : Error(s(310));
			G = e, e = {
				memoizedState: G.memoizedState,
				baseState: G.baseState,
				baseQueue: G.baseQueue,
				queue: G.queue,
				next: null
			}, Bo === null ? W.memoizedState = Bo = e : Bo = Bo.next = e;
		}
		return Bo;
	}
	function as() {
		return {
			lastEffect: null,
			events: null,
			stores: null,
			memoCache: null
		};
	}
	function os(e) {
		var t = Go;
		return Go += 1, Ko === null && (Ko = []), e = Za(Ko, e, t), t = W, (Bo === null ? t.memoizedState : Bo.next) === null && (t = t.alternate, k.H = t === null || t.memoizedState === null ? pc : mc), e;
	}
	function ss(e) {
		if (typeof e == "object" && e) {
			if (typeof e.then == "function") return os(e);
			if (e.$$typeof === ge) return;
			if (e.$$typeof === ce) return Sa(e);
		}
		throw Error(s(438, String(e)));
	}
	function cs(e) {
		var t = null, n = W.updateQueue;
		if (n !== null && (t = n.memoCache), t == null) {
			var r = W.alternate;
			r !== null && (r = r.updateQueue, r !== null && (r = r.memoCache, r != null && (t = {
				data: r.data.map(function(e) {
					return e.slice();
				}),
				index: 0
			})));
		}
		if (t ??= {
			data: [],
			index: 0
		}, n === null && (n = as(), W.updateQueue = n), n.memoCache = t, n = t.data[t.index], n === void 0) for (n = t.data[t.index] = Array(e), r = 0; r < e; r++) n[r] = me;
		return t.index++, n;
	}
	function ls(e, t) {
		return typeof t == "function" ? t(e) : t;
	}
	function us(e) {
		return ds(is(), G, e);
	}
	function ds(e, t, n) {
		var r = e.queue;
		if (r === null) throw Error(s(311));
		r.lastRenderedReducer = n;
		var i = e.baseQueue, a = r.pending;
		if (a !== null) {
			if (i !== null) {
				var o = i.next;
				i.next = a.next, a.next = o;
			}
			t.baseQueue = i = a, r.pending = null;
		}
		if (a = e.baseState, i === null) e.memoizedState = a;
		else {
			t = i.next;
			var c = o = null, l = null, u = t, d = !1;
			do {
				var f = u.lane & -536870913;
				if (f === u.lane ? (zo & f) === f : (Y & f) === f) {
					var p = u.revertLane;
					if (p === 0) l !== null && (l = l.next = {
						lane: 0,
						revertLane: 0,
						gesture: null,
						action: u.action,
						hasEagerState: u.hasEagerState,
						eagerState: u.eagerState,
						next: null
					}), f === Ia && (d = !0);
					else if ((zo & p) === p) {
						u = u.next, p === Ia && (d = !0);
						continue;
					} else f = {
						lane: 0,
						revertLane: u.revertLane,
						gesture: null,
						action: u.action,
						hasEagerState: u.hasEagerState,
						eagerState: u.eagerState,
						next: null
					}, l === null ? (c = l = f, o = a) : l = l.next = f, W.lanes |= p, od |= p;
					f = u.action, Uo && n(a, f), a = u.hasEagerState ? u.eagerState : n(a, f);
				} else p = {
					lane: f,
					revertLane: u.revertLane,
					gesture: u.gesture,
					action: u.action,
					hasEagerState: u.hasEagerState,
					eagerState: u.eagerState,
					next: null
				}, l === null ? (c = l = p, o = a) : l = l.next = p, W.lanes |= f, od |= f;
				u = u.next;
			} while (u !== null && u !== t);
			if (l === null ? o = a : l.next = c, !Rr(a, e.memoizedState) && (jc = !0, d && (n = La, n !== null))) throw n;
			e.memoizedState = a, e.baseState = o, e.baseQueue = l, r.lastRenderedState = a;
		}
		return i === null && (r.lanes = 0), [e.memoizedState, r.dispatch];
	}
	function fs(e) {
		var t = is(), n = t.queue;
		if (n === null) throw Error(s(311));
		n.lastRenderedReducer = e;
		var r = n.dispatch, i = n.pending, a = t.memoizedState;
		if (i !== null) {
			n.pending = null;
			var o = i = i.next;
			do
				a = e(a, o.action), o = o.next;
			while (o !== i);
			Rr(a, t.memoizedState) || (jc = !0), t.memoizedState = a, t.baseQueue === null && (t.baseState = a), n.lastRenderedState = a;
		}
		return [a, r];
	}
	function ps(e, t, n) {
		var r = W, i = is(), a = U;
		if (a) {
			if (n === void 0) throw Error(s(407));
			n = n();
		} else n = t();
		var o = !Rr((G || i).memoizedState, n);
		if (o && (i.memoizedState = n, jc = !0), i = i.queue, Rs(gs.bind(null, r, i, e), [e]), e = i.getSnapshot !== t || o || Bo !== null && !!(Bo.memoizedState.tag & 1), Ns(e ? 9 : 8, { destroy: void 0 }, hs.bind(null, r, i, n, t), null), e) {
			if (r.flags |= 2048, $u === null) throw Error(s(349));
			a || zo & 127 || ms(r, t, n);
		}
		return n;
	}
	function ms(e, t, n) {
		e.flags |= 16384, e = {
			getSnapshot: t,
			value: n
		}, t = W.updateQueue, t === null ? (t = as(), W.updateQueue = t, t.stores = [e]) : (n = t.stores, n === null ? t.stores = [e] : n.push(e));
	}
	function hs(e, t, n, r) {
		t.value = n, t.getSnapshot = r, _s(t) && vs(e);
	}
	function gs(e, t, n) {
		return n(function() {
			_s(t) && vs(e);
		});
	}
	function _s(e) {
		var t = e.getSnapshot;
		e = e.value;
		try {
			var n = t();
			return !Rr(e, n);
		} catch {
			return !0;
		}
	}
	function vs(e) {
		var t = wi(e, 2);
		t !== null && Pd(t, e, 2);
	}
	function ys(e) {
		var t = rs();
		if (typeof e == "function") {
			var n = e;
			if (e = n(), Uo) {
				F(!0);
				try {
					n();
				} finally {
					F(!1);
				}
			}
		}
		return t.memoizedState = t.baseState = e, t.queue = {
			pending: null,
			lanes: 0,
			dispatch: null,
			lastRenderedReducer: ls,
			lastRenderedState: e
		}, t;
	}
	function bs(e, t, n, r) {
		return e.baseState = n, ds(e, G, typeof r == "function" ? r : ls);
	}
	function xs(e, t, n, r, i) {
		if (lc(e)) throw Error(s(485));
		if (e = t.action, e !== null) {
			var a = {
				payload: i,
				action: e,
				next: null,
				isTransition: !0,
				status: "pending",
				value: null,
				reason: null,
				listeners: [],
				then: function(e) {
					a.listeners.push(e);
				}
			};
			k.T === null ? a.isTransition = !1 : n(!0), r(a), n = t.pending, n === null ? (a.next = t.pending = a, Ss(t, a)) : (a.next = n.next, t.pending = n.next = a);
		}
	}
	function Ss(e, t) {
		var n = t.action, r = t.payload, i = e.state;
		if (t.isTransition) {
			var a = k.T, o = {};
			o.types = a === null ? null : a.types, k.T = o;
			try {
				var s = n(i, r), c = k.S;
				c !== null && c(o, s), Cs(e, t, s);
			} catch (n) {
				Ts(e, t, n);
			} finally {
				a !== null && o.types !== null && (a.types = o.types), k.T = a;
			}
		} else try {
			a = n(i, r), Cs(e, t, a);
		} catch (n) {
			Ts(e, t, n);
		}
	}
	function Cs(e, t, n) {
		typeof n == "object" && n && typeof n.then == "function" ? n.then(function(n) {
			ws(e, t, n);
		}, function(n) {
			return Ts(e, t, n);
		}) : ws(e, t, n);
	}
	function ws(e, t, n) {
		t.status = "fulfilled", t.value = n, Es(t), e.state = n, t = e.pending, t !== null && (n = t.next, n === t ? e.pending = null : (n = n.next, t.next = n, Ss(e, n)));
	}
	function Ts(e, t, n) {
		var r = e.pending;
		if (e.pending = null, r !== null) {
			r = r.next;
			do
				t.status = "rejected", t.reason = n, Es(t), t = t.next;
			while (t !== r);
		}
		e.action = null;
	}
	function Es(e) {
		e = e.listeners;
		for (var t = 0; t < e.length; t++) (0, e[t])();
	}
	function Ds(e, t) {
		return t;
	}
	function Os(e, t) {
		if (U) {
			var n = $u.formState;
			if (n !== null) {
				a: {
					var r = W;
					if (U) {
						if (ta) {
							b: {
								for (var i = ta, a = ra; i.nodeType !== 8;) if (!a || (i = lm(i.nextSibling), i === null)) {
									i = null;
									break b;
								}
								a = i.data, i = a === "F!" || a === "F" ? i : null;
							}
							if (i) {
								ta = lm(i.nextSibling), r = i.data === "F!";
								break a;
							}
						}
						aa(r);
					}
					r = !1;
				}
				r && (t = n[0]);
			}
		}
		return n = rs(), n.memoizedState = n.baseState = t, r = {
			pending: null,
			lanes: 0,
			dispatch: null,
			lastRenderedReducer: Ds,
			lastRenderedState: t
		}, n.queue = r, n = oc.bind(null, W, r), r.dispatch = n, r = ys(!1), a = cc.bind(null, W, !1, r.queue), r = rs(), i = {
			state: t,
			dispatch: null,
			action: e,
			pending: null
		}, r.queue = i, n = xs.bind(null, W, i, a, n), i.dispatch = n, r.memoizedState = e, [
			t,
			n,
			!1
		];
	}
	function ks(e) {
		return As(is(), G, e);
	}
	function As(e, t, n) {
		if (t = ds(e, t, Ds)[0], e = us(ls)[0], typeof t == "object" && t && typeof t.then == "function") try {
			var r = os(t);
		} catch (e) {
			throw e === Ka ? Ja : e;
		}
		else r = t;
		t = is();
		var i = t.queue, a = i.dispatch;
		return n !== t.memoizedState && (W.flags |= 2048, Ns(9, { destroy: void 0 }, js.bind(null, i, n), null)), [
			r,
			a,
			e
		];
	}
	function js(e, t) {
		e.action = t;
	}
	function Ms(e) {
		var t = is(), n = G;
		if (n !== null) return As(t, n, e);
		is(), t = t.memoizedState, n = is();
		var r = n.queue.dispatch;
		return n.memoizedState = e, [
			t,
			r,
			!1
		];
	}
	function Ns(e, t, n, r) {
		return e = {
			tag: e,
			create: n,
			deps: r,
			inst: t,
			next: null
		}, t = W.updateQueue, t === null && (t = as(), W.updateQueue = t), n = t.lastEffect, n === null ? t.lastEffect = e.next = e : (r = n.next, n.next = e, e.next = r, t.lastEffect = e), e;
	}
	function Ps() {
		return is().memoizedState;
	}
	function Fs(e, t, n, r) {
		var i = rs();
		W.flags |= e, i.memoizedState = Ns(1 | t, { destroy: void 0 }, n, r === void 0 ? null : r);
	}
	function Is(e, t, n, r) {
		var i = is();
		r = r === void 0 ? null : r;
		var a = i.memoizedState.inst;
		G !== null && r !== null && Yo(r, G.memoizedState.deps) ? i.memoizedState = Ns(t, a, n, r) : (W.flags |= e, i.memoizedState = Ns(1 | t, a, n, r));
	}
	function Ls(e, t) {
		Fs(8390656, 8, e, t);
	}
	function Rs(e, t) {
		Is(2048, 8, e, t);
	}
	function zs(e) {
		W.flags |= 4;
		var t = W.updateQueue;
		if (t === null) t = as(), W.updateQueue = t, t.events = [e];
		else {
			var n = t.events;
			n === null ? t.events = [e] : n.push(e);
		}
	}
	function Bs(e) {
		var t = is().memoizedState;
		return zs({
			ref: t,
			nextImpl: e
		}), function() {
			if (q & 2) throw Error(s(440));
			return t.impl.apply(void 0, arguments);
		};
	}
	function Vs(e, t) {
		return Is(4, 2, e, t);
	}
	function Hs(e, t) {
		return Is(4, 4, e, t);
	}
	function Us(e, t) {
		if (typeof t == "function") {
			e = e();
			var n = t(e);
			return function() {
				typeof n == "function" ? n() : t(null);
			};
		}
		if (t != null) return e = e(), t.current = e, function() {
			t.current = null;
		};
	}
	function Ws(e, t, n) {
		n = n == null ? null : n.concat([e]), Is(4, 4, Us.bind(null, t, e), n);
	}
	function Gs() {}
	function Ks(e, t) {
		var n = is();
		t = t === void 0 ? null : t;
		var r = n.memoizedState;
		return t !== null && Yo(t, r[1]) ? r[0] : (n.memoizedState = [e, t], e);
	}
	function qs(e, t) {
		var n = is();
		t = t === void 0 ? null : t;
		var r = n.memoizedState;
		if (t !== null && Yo(t, r[1])) return r[0];
		if (r = e(), Uo) {
			F(!0);
			try {
				e();
			} finally {
				F(!1);
			}
		}
		return n.memoizedState = [r, t], r;
	}
	function Js(e, t, n) {
		return n === void 0 || zo & 1073741824 && !(Y & 261930) ? e.memoizedState = t : (e.memoizedState = n, e = Md(), W.lanes |= e, od |= e, n);
	}
	function Ys(e, t, n, r) {
		return Rr(n, t) ? n : Co.current === null ? !(zo & 106) || zo & 1073741824 && !(Y & 261930) ? (jc = !0, e.memoizedState = n) : (e = Md(), W.lanes |= e, od |= e, t) : (e = Js(e, n, r), Rr(e, t) || (jc = !0), e);
	}
	function Xs(e, t, n, r, i) {
		var a = A.p;
		A.p = a !== 0 && 8 > a ? a : 8;
		var o = k.T, s = {};
		s.types = o === null ? null : o.types, k.T = s, cc(e, !1, t, n);
		try {
			var c = i(), l = k.S;
			l !== null && l(s, c), typeof c == "object" && c && typeof c.then == "function" ? sc(e, t, Ba(c, r), jd(e)) : sc(e, t, r, jd(e));
		} catch (n) {
			sc(e, t, {
				then: function() {},
				status: "rejected",
				reason: n
			}, jd());
		} finally {
			A.p = a, o !== null && s.types !== null && (o.types = s.types), k.T = o;
		}
	}
	function Zs() {}
	function Qs(e, t, n, r) {
		if (e.tag !== 5) throw Error(s(476));
		var i = $s(e).queue;
		Xs(e, i, t, j, n === null ? Zs : function() {
			return ec(e), n(r);
		});
	}
	function $s(e) {
		var t = e.memoizedState;
		if (t !== null) return t;
		t = {
			memoizedState: j,
			baseState: j,
			baseQueue: null,
			queue: {
				pending: null,
				lanes: 0,
				dispatch: null,
				lastRenderedReducer: ls,
				lastRenderedState: j
			},
			next: null
		};
		var n = {};
		return t.next = {
			memoizedState: n,
			baseState: n,
			baseQueue: null,
			queue: {
				pending: null,
				lanes: 0,
				dispatch: null,
				lastRenderedReducer: ls,
				lastRenderedState: n
			},
			next: null
		}, e.memoizedState = t, e = e.alternate, e !== null && (e.memoizedState = t), t;
	}
	function ec(e) {
		var t = $s(e);
		t.next === null && (t = e.alternate.memoizedState), sc(e, t.next.queue, {}, jd());
	}
	function tc() {
		return Sa(sh);
	}
	function nc() {
		return is().memoizedState;
	}
	function rc() {
		return is().memoizedState;
	}
	function ic(e) {
		for (var t = e.return; t !== null;) {
			switch (t.tag) {
				case 24:
				case 3:
					var n = jd();
					e = mo(n);
					var r = ho(t, e, n);
					r !== null && (Pd(r, t, n), go(r, t, n)), t = { cache: ka() }, e.payload = t;
					return;
			}
			t = t.return;
		}
	}
	function ac(e, t, n) {
		var r = jd();
		n = {
			lane: r,
			revertLane: 0,
			gesture: null,
			action: n,
			hasEagerState: !1,
			eagerState: null,
			next: null
		}, lc(e) ? uc(t, n) : (n = Ci(e, t, n, r), n !== null && (Pd(n, e, r), dc(n, t, r)));
	}
	function oc(e, t, n) {
		sc(e, t, n, jd());
	}
	function sc(e, t, n, r) {
		var i = {
			lane: r,
			revertLane: 0,
			gesture: null,
			action: n,
			hasEagerState: !1,
			eagerState: null,
			next: null
		};
		if (lc(e)) uc(t, i);
		else {
			var a = e.alternate;
			if (e.lanes === 0 && (a === null || a.lanes === 0) && (a = t.lastRenderedReducer, a !== null)) try {
				var o = t.lastRenderedState, s = a(o, n);
				if (i.hasEagerState = !0, i.eagerState = s, Rr(s, o)) return Si(e, t, i, 0), $u === null && xi(), !1;
			} catch {}
			if (n = Ci(e, t, i, r), n !== null) return Pd(n, e, r), dc(n, t, r), !0;
		}
		return !1;
	}
	function cc(e, t, n, r) {
		if (r = {
			lane: 2,
			revertLane: Pf(),
			gesture: null,
			action: r,
			hasEagerState: !1,
			eagerState: null,
			next: null
		}, lc(e)) {
			if (t) throw Error(s(479));
		} else t = Ci(e, n, r, 2), t !== null && Pd(t, e, 2);
	}
	function lc(e) {
		var t = e.alternate;
		return e === W || t !== null && t === W;
	}
	function uc(e, t) {
		Ho = Vo = !0;
		var n = e.pending;
		n === null ? t.next = t : (t.next = n.next, n.next = t), e.pending = t;
	}
	function dc(e, t, n) {
		if (n & 4194048) {
			var r = t.lanes;
			r &= e.pendingLanes, n |= r, t.lanes = n, vt(e, n);
		}
	}
	var fc = {
		readContext: Sa,
		use: ss,
		useCallback: Jo,
		useContext: Jo,
		useEffect: Jo,
		useImperativeHandle: Jo,
		useLayoutEffect: Jo,
		useInsertionEffect: Jo,
		useMemo: Jo,
		useReducer: Jo,
		useRef: Jo,
		useState: Jo,
		useDebugValue: Jo,
		useDeferredValue: Jo,
		useTransition: Jo,
		useSyncExternalStore: Jo,
		useId: Jo,
		useHostTransitionStatus: Jo,
		useFormState: Jo,
		useActionState: Jo,
		useOptimistic: Jo,
		useMemoCache: Jo,
		useCacheRefresh: Jo,
		useEffectEvent: Jo
	}, pc = {
		readContext: Sa,
		use: ss,
		useCallback: function(e, t) {
			return rs().memoizedState = [e, t === void 0 ? null : t], e;
		},
		useContext: Sa,
		useEffect: Ls,
		useImperativeHandle: function(e, t, n) {
			n = n == null ? null : n.concat([e]), Fs(4194308, 4, Us.bind(null, t, e), n);
		},
		useLayoutEffect: function(e, t) {
			return Fs(4194308, 4, e, t);
		},
		useInsertionEffect: function(e, t) {
			Fs(4, 2, e, t);
		},
		useMemo: function(e, t) {
			var n = rs();
			t = t === void 0 ? null : t;
			var r = e();
			if (Uo) {
				F(!0);
				try {
					e();
				} finally {
					F(!1);
				}
			}
			return n.memoizedState = [r, t], r;
		},
		useReducer: function(e, t, n) {
			var r = rs();
			if (n !== void 0) {
				var i = n(t);
				if (Uo) {
					F(!0);
					try {
						n(t);
					} finally {
						F(!1);
					}
				}
			} else i = t;
			return r.memoizedState = r.baseState = i, e = {
				pending: null,
				lanes: 0,
				dispatch: null,
				lastRenderedReducer: e,
				lastRenderedState: i
			}, r.queue = e, e = e.dispatch = ac.bind(null, W, e), [r.memoizedState, e];
		},
		useRef: function(e) {
			var t = rs();
			return e = { current: e }, t.memoizedState = e;
		},
		useState: function(e) {
			e = ys(e);
			var t = e.queue, n = oc.bind(null, W, t);
			return t.dispatch = n, [e.memoizedState, n];
		},
		useDebugValue: Gs,
		useDeferredValue: function(e, t) {
			return Js(rs(), e, t);
		},
		useTransition: function() {
			var e = ys(!1);
			return e = Xs.bind(null, W, e.queue, !0, !1), rs().memoizedState = e, [!1, e];
		},
		useSyncExternalStore: function(e, t, n) {
			var r = W, i = rs();
			if (U) {
				if (n === void 0) throw Error(s(407));
				n = n();
			} else {
				if (n = t(), $u === null) throw Error(s(349));
				Y & 127 || ms(r, t, n);
			}
			i.memoizedState = n;
			var a = {
				value: n,
				getSnapshot: t
			};
			return i.queue = a, Ls(gs.bind(null, r, a, e), [e]), r.flags |= 2048, Ns(9, { destroy: void 0 }, hs.bind(null, r, a, n, t), null), n;
		},
		useId: function() {
			var e = rs(), t = $u.identifierPrefix;
			if (U) {
				var n = Ji, r = qi;
				n = (r & ~(1 << 32 - tt(r) - 1)).toString(32) + n, t = "_" + t + "R_" + n, n = Wo++, 0 < n && (t += "H" + n.toString(32)), t += "_";
			} else n = qo++, t = "_" + t + "r_" + n.toString(32) + "_";
			return e.memoizedState = t;
		},
		useHostTransitionStatus: tc,
		useFormState: Os,
		useActionState: Os,
		useOptimistic: function(e) {
			var t = rs();
			t.memoizedState = t.baseState = e;
			var n = {
				pending: null,
				lanes: 0,
				dispatch: null,
				lastRenderedReducer: null,
				lastRenderedState: null
			};
			return t.queue = n, t = cc.bind(null, W, !0, n), n.dispatch = t, [e, t];
		},
		useMemoCache: cs,
		useCacheRefresh: function() {
			return rs().memoizedState = ic.bind(null, W);
		},
		useEffectEvent: function(e) {
			var t = rs(), n = { impl: e };
			return t.memoizedState = n, function() {
				if (q & 2) throw Error(s(440));
				return n.impl.apply(void 0, arguments);
			};
		}
	}, mc = {
		readContext: Sa,
		use: ss,
		useCallback: Ks,
		useContext: Sa,
		useEffect: Rs,
		useImperativeHandle: Ws,
		useInsertionEffect: Vs,
		useLayoutEffect: Hs,
		useMemo: qs,
		useReducer: us,
		useRef: Ps,
		useState: function() {
			return us(ls);
		},
		useDebugValue: Gs,
		useDeferredValue: function(e, t) {
			return Ys(is(), G.memoizedState, e, t);
		},
		useTransition: function() {
			var e = us(ls)[0], t = is().memoizedState;
			return [typeof e == "boolean" ? e : os(e), t];
		},
		useSyncExternalStore: ps,
		useId: nc,
		useHostTransitionStatus: tc,
		useFormState: ks,
		useActionState: ks,
		useOptimistic: function(e, t) {
			return bs(is(), G, e, t);
		},
		useMemoCache: cs,
		useCacheRefresh: rc,
		useEffectEvent: Bs
	}, hc = {
		readContext: Sa,
		use: ss,
		useCallback: Ks,
		useContext: Sa,
		useEffect: Rs,
		useImperativeHandle: Ws,
		useInsertionEffect: Vs,
		useLayoutEffect: Hs,
		useMemo: qs,
		useReducer: fs,
		useRef: Ps,
		useState: function() {
			return fs(ls);
		},
		useDebugValue: Gs,
		useDeferredValue: function(e, t) {
			var n = is();
			return G === null ? Js(n, e, t) : Ys(n, G.memoizedState, e, t);
		},
		useTransition: function() {
			var e = fs(ls)[0], t = is().memoizedState;
			return [typeof e == "boolean" ? e : os(e), t];
		},
		useSyncExternalStore: ps,
		useId: nc,
		useHostTransitionStatus: tc,
		useFormState: Ms,
		useActionState: Ms,
		useOptimistic: function(e, t) {
			var n = is();
			return G === null ? (n.baseState = e, [e, n.queue.dispatch]) : bs(n, G, e, t);
		},
		useMemoCache: cs,
		useCacheRefresh: rc,
		useEffectEvent: Bs
	};
	function gc(e, t, n, r) {
		t = e.memoizedState, n = n(r, t), n = n == null ? t : T({}, t, n), e.memoizedState = n, e.lanes === 0 && (e.updateQueue.baseState = n);
	}
	var _c = {
		enqueueSetState: function(e, t, n) {
			e = e._reactInternals;
			var r = jd(), i = mo(r);
			i.payload = t, n != null && (i.callback = n), t = ho(e, i, r), t !== null && (Pd(t, e, r), go(t, e, r));
		},
		enqueueReplaceState: function(e, t, n) {
			e = e._reactInternals;
			var r = jd(), i = mo(r);
			i.tag = 1, i.payload = t, n != null && (i.callback = n), t = ho(e, i, r), t !== null && (Pd(t, e, r), go(t, e, r));
		},
		enqueueForceUpdate: function(e, t) {
			e = e._reactInternals;
			var n = jd(), r = mo(n);
			r.tag = 2, t != null && (r.callback = t), t = ho(e, r, n), t !== null && (Pd(t, e, n), go(t, e, n));
		}
	};
	function vc(e, t, n, r, i, a, o) {
		return e = e.stateNode, typeof e.shouldComponentUpdate == "function" ? e.shouldComponentUpdate(r, a, o) : t.prototype && t.prototype.isPureReactComponent ? !zr(n, r) || !zr(i, a) : !0;
	}
	function yc(e, t, n, r) {
		e = t.state, typeof t.componentWillReceiveProps == "function" && t.componentWillReceiveProps(n, r), typeof t.UNSAFE_componentWillReceiveProps == "function" && t.UNSAFE_componentWillReceiveProps(n, r), t.state !== e && _c.enqueueReplaceState(t, t.state, null);
	}
	function bc(e, t) {
		var n = t;
		if ("ref" in t) for (var r in n = {}, t) r !== "ref" && (n[r] = t[r]);
		if (e = e.defaultProps) for (var i in n === t && (n = T({}, n)), e) n[i] === void 0 && (n[i] = e[i]);
		return n;
	}
	function xc(e) {
		_i(e);
	}
	function Sc(e) {
		console.error(e);
	}
	function Cc(e) {
		_i(e);
	}
	function wc(e, t) {
		try {
			var n = e.onUncaughtError;
			n(t.value, { componentStack: t.stack });
		} catch (e) {
			setTimeout(function() {
				throw e;
			});
		}
	}
	function Tc(e, t, n) {
		try {
			var r = e.onCaughtError;
			r(n.value, {
				componentStack: n.stack,
				errorBoundary: t.tag === 1 ? t.stateNode : null
			});
		} catch (e) {
			setTimeout(function() {
				throw e;
			});
		}
	}
	function Ec(e, t, n) {
		return n = mo(n), n.tag = 3, n.payload = { element: null }, n.callback = function() {
			wc(e, t);
		}, n;
	}
	function Dc(e) {
		return e = mo(e), e.tag = 3, e;
	}
	function Oc(e, t, n, r) {
		var i = n.type.getDerivedStateFromError;
		if (typeof i == "function") {
			var a = r.value;
			e.payload = function() {
				return i(a);
			}, e.callback = function() {
				Tc(t, n, r);
			};
		}
		var o = n.stateNode;
		o !== null && typeof o.componentDidCatch == "function" && (e.callback = function() {
			Tc(t, n, r), typeof i != "function" && (vd === null ? vd = /* @__PURE__ */ new Set([this]) : vd.add(this));
			var e = r.stack;
			this.componentDidCatch(r.value, { componentStack: e === null ? "" : e });
		});
	}
	function kc(e, t, n, r, i) {
		if (n.flags |= 32768, typeof r == "object" && r && typeof r.then == "function") {
			if (t = n.alternate, t !== null && ya(t, n, i, !0), n = Oo.current, n !== null) {
				switch (n.tag) {
					case 31:
					case 13:
					case 19: return ko === null ? Kd() : n.alternate === null && ad === 0 && (ad = 3), n.flags &= -257, n.flags |= 65536, n.lanes = i, r === Ya ? n.flags |= 16384 : (t = n.updateQueue, t === null ? n.updateQueue = /* @__PURE__ */ new Set([r]) : t.add(r), mf(e, r, i)), !1;
					case 22: return n.flags |= 65536, r === Ya ? n.flags |= 16384 : (t = n.updateQueue, t === null ? (t = {
						transitions: null,
						markerInstances: null,
						retryQueue: /* @__PURE__ */ new Set([r])
					}, n.updateQueue = t) : (n = t.retryQueue, n === null ? t.retryQueue = /* @__PURE__ */ new Set([r]) : n.add(r)), mf(e, r, i)), !1;
				}
				throw Error(s(435, n.tag));
			}
			return mf(e, r, i), Kd(), !1;
		}
		if (U) return t = Oo.current, t === null ? (r !== ia && (t = Error(s(423), { cause: r }), da(zi(t, n))), e = e.current.alternate, e.flags |= 65536, i &= -i, e.lanes |= i, r = zi(r, n), i = Ec(e.stateNode, r, i), _o(e, i), ad !== 4 && (ad = 2)) : (!(t.flags & 65536) && (t.flags |= 256), t.flags |= 65536, t.lanes = i, r !== ia && (e = Error(s(422), { cause: r }), da(zi(e, n)))), !1;
		var a = Error(s(520), { cause: r });
		if (a = zi(a, n), dd === null ? dd = [a] : dd.push(a), ad !== 4 && (ad = 2), t === null) return !0;
		r = zi(r, n), n = t;
		do {
			switch (n.tag) {
				case 3: return n.flags |= 65536, e = i & -i, n.lanes |= e, e = Ec(n.stateNode, r, e), _o(n, e), !1;
				case 1:
					if (t = n.type, a = n.stateNode, !(n.flags & 128) && (typeof t.getDerivedStateFromError == "function" || a !== null && typeof a.componentDidCatch == "function" && (vd === null || !vd.has(a)))) return n.flags |= 65536, i &= -i, n.lanes |= i, i = Dc(i), Oc(i, e, n, r), _o(n, i), !1;
					break;
				case 22: if (n.memoizedState !== null) return n.flags |= 65536, !1;
			}
			n = n.return;
		} while (n !== null);
		return !1;
	}
	var Ac = Error(s(461)), jc = !1;
	function Mc(e, t, n, r) {
		t.child = e === null ? lo(t, null, n, r) : co(t, e.child, n, r);
	}
	function Nc(e, t, n, r, i) {
		n = n.render;
		var a = t.ref;
		if ("ref" in r) {
			var o = {};
			for (var s in r) s !== "ref" && (o[s] = r[s]);
		} else o = r;
		return xa(t), r = Xo(e, t, n, o, a, i), s = es(), e !== null && !jc ? (ts(e, t, i), sl(e, t, i)) : (U && s && Zi(t), t.flags |= 1, Mc(e, t, r, i), t.child);
	}
	function Pc(e, t, n, r, i) {
		if (e === null) {
			var a = n.type;
			return typeof a == "function" && !Ai(a) && a.defaultProps === void 0 && n.compare === null ? (t.tag = 15, t.type = a, Fc(e, t, a, r, i)) : (e = Ni(n.type, null, r, t, t.mode, i), e.ref = t.ref, e.return = t, t.child = e);
		}
		if (a = e.child, !cl(e, i)) {
			var o = a.memoizedProps;
			if (n = n.compare, n = n === null ? zr : n, n(o, r) && e.ref === t.ref) return sl(e, t, i);
		}
		return t.flags |= 1, e = ji(a, r), e.ref = t.ref, e.return = t, t.child = e;
	}
	function Fc(e, t, n, r, i) {
		if (e !== null) {
			var a = e.memoizedProps;
			if (zr(a, r) && e.ref === t.ref) {
				if (jc = !1, t.pendingProps = r = a, cl(e, i)) e.flags & 131072 && (jc = !0);
				else return t.lanes = e.lanes, sl(e, t, i);
			}
		}
		return Uc(e, t, n, r, i);
	}
	function Ic(e, t, n, r) {
		var i = r.children, a = e === null ? null : e.memoizedState;
		if (e === null && t.stateNode === null && (t.stateNode = {
			_visibility: 1,
			_pendingMarkers: null,
			_retryCache: null,
			_transitions: null
		}), r.mode === "hidden") {
			if (t.flags & 128) {
				if (a = a === null ? n : a.baseLanes | n, e !== null) {
					for (r = t.child = e.child, i = 0; r !== null;) i = i | r.lanes | r.childLanes, r = r.sibling;
					r = i & ~a;
				} else r = 0, t.child = null;
				return Rc(e, t, a, n, r);
			}
			if (n & 536870912) t.memoizedState = {
				baseLanes: 0,
				cachePool: null
			}, e !== null && Wa(t, a === null ? null : a.cachePool), a === null ? Eo() : To(t, a), Mo(t);
			else return r = t.lanes = 536870912, Rc(e, t, a === null ? n : a.baseLanes | n, n, r);
		} else a === null ? (e !== null && Wa(t, null), Eo(), No()) : (Wa(t, a.cachePool), To(t, a), No(), t.memoizedState = null);
		return Mc(e, t, i, n), t.child;
	}
	function Lc(e, t) {
		return e !== null && e.tag === 22 || t.stateNode !== null || (t.stateNode = {
			_visibility: 1,
			_pendingMarkers: null,
			_retryCache: null,
			_transitions: null
		}), t.sibling;
	}
	function Rc(e, t, n, r, i) {
		var a = Ua();
		return a = a === null ? null : {
			parent: Oa._currentValue,
			pool: a
		}, t.memoizedState = {
			baseLanes: n,
			cachePool: a
		}, e !== null && Wa(t, null), Eo(), Mo(t), e !== null && ya(e, t, r, !0), t.childLanes = i, null;
	}
	function zc(e, t) {
		return t = Qc({
			mode: t.mode,
			children: t.children
		}, e.mode), t.ref = e.ref, e.child = t, t.return = e, t;
	}
	function Bc(e, t, n) {
		return co(t, e.child, null, n), e = zc(t, t.pendingProps), e.flags |= 2, Po(t), t.memoizedState = null, e;
	}
	function Vc(e, t, n) {
		var r = t.pendingProps, i = !!(t.flags & 128);
		if (t.flags &= -129, e === null) {
			if (U) {
				if (r.mode === "hidden") return e = zc(t, r), t.lanes = 536870912, e.memoizedState = {
					baseLanes: 0,
					cachePool: null
				}, Lc(null, e);
				if (jo(t), (e = ta) ? (e = am(e, ra), e = e !== null && e.data === "&" ? e : null, e !== null && (t.memoizedState = {
					dehydrated: e,
					treeContext: Ki === null ? null : {
						id: qi,
						overflow: Ji
					},
					retryLane: 536870912,
					hydrationErrors: null
				}, n = Ii(e), n.return = t, t.child = n, ea = t, ta = null)) : e = null, e === null) throw aa(t);
				return t.lanes = 536870912, null;
			}
			return zc(t, r);
		}
		var a = e.memoizedState;
		if (a !== null) {
			var o = a.dehydrated;
			if (jo(t), i) {
				if (t.flags & 256) t.flags &= -257, t = Bc(e, t, n);
				else if (t.memoizedState !== null) t.child = e.child, t.flags |= 128, t = null;
				else throw Error(s(558));
			} else if (jc || ya(e, t, n, !1), i = (n & e.childLanes) !== 0, jc || i) {
				if (Co.current === null) {
					if (r = $u, r !== null && (o = I(r, n), o !== 0 && o !== a.retryLane)) throw a.retryLane = o, wi(e, o), Pd(r, e, o), Ac;
					Kd();
				}
				t = Bc(e, t, n);
			} else e = a.treeContext, ta = lm(o.nextSibling), ea = t, U = !0, na = null, ra = !1, e !== null && $i(t, e), t = zc(t, r), t.flags |= 134221824;
			return t;
		}
		return e = ji(e.child, {
			mode: r.mode,
			children: r.children
		}), e.ref = t.ref, t.child = e, e.return = t, e;
	}
	function Hc(e, t) {
		var n = t.ref;
		if (n === null) e !== null && e.ref !== null && (t.flags |= 4194816);
		else {
			if (typeof n != "function" && typeof n != "object") throw Error(s(284));
			(e === null || e.ref !== n) && (t.flags |= 4194816);
		}
	}
	function Uc(e, t, n, r, i) {
		return xa(t), n = Xo(e, t, n, r, void 0, i), r = es(), e !== null && !jc ? (ts(e, t, i), sl(e, t, i)) : (U && r && Zi(t), t.flags |= 1, Mc(e, t, n, i), t.child);
	}
	function Wc(e, t, n, r, i, a) {
		return xa(t), t.updateQueue = null, n = Qo(t, r, n, i), Zo(e), r = es(), e !== null && !jc ? (ts(e, t, a), sl(e, t, a)) : (U && r && Zi(t), t.flags |= 1, Mc(e, t, n, a), t.child);
	}
	function Gc(e, t, n, r, i) {
		if (xa(t), t.stateNode === null) {
			var a = Di, o = n.contextType;
			typeof o == "object" && o && (a = Sa(o)), a = new n(r, a), t.memoizedState = a.state !== null && a.state !== void 0 ? a.state : null, a.updater = _c, t.stateNode = a, a._reactInternals = t, a = t.stateNode, a.props = r, a.state = t.memoizedState, a.refs = {}, fo(t), o = n.contextType, a.context = typeof o == "object" && o ? Sa(o) : Di, a.state = t.memoizedState, o = n.getDerivedStateFromProps, typeof o == "function" && (gc(t, n, o, r), a.state = t.memoizedState), typeof n.getDerivedStateFromProps == "function" || typeof a.getSnapshotBeforeUpdate == "function" || typeof a.UNSAFE_componentWillMount != "function" && typeof a.componentWillMount != "function" || (o = a.state, typeof a.componentWillMount == "function" && a.componentWillMount(), typeof a.UNSAFE_componentWillMount == "function" && a.UNSAFE_componentWillMount(), o !== a.state && _c.enqueueReplaceState(a, a.state, null), bo(t, r, a, i), yo(), a.state = t.memoizedState), typeof a.componentDidMount == "function" && (t.flags |= 4194308), r = !0;
		} else if (e === null) {
			a = t.stateNode;
			var s = t.memoizedProps, c = bc(n, s);
			a.props = c;
			var l = a.context, u = n.contextType;
			o = Di, typeof u == "object" && u && (o = Sa(u));
			var d = n.getDerivedStateFromProps;
			u = typeof d == "function" || typeof a.getSnapshotBeforeUpdate == "function", s = t.pendingProps !== s, u || typeof a.UNSAFE_componentWillReceiveProps != "function" && typeof a.componentWillReceiveProps != "function" || (s || l !== o) && yc(t, a, r, o), uo = !1;
			var f = t.memoizedState;
			a.state = f, bo(t, r, a, i), yo(), l = t.memoizedState, s || f !== l || uo ? (typeof d == "function" && (gc(t, n, d, r), l = t.memoizedState), (c = uo || vc(t, n, c, r, f, l, o)) ? (u || typeof a.UNSAFE_componentWillMount != "function" && typeof a.componentWillMount != "function" || (typeof a.componentWillMount == "function" && a.componentWillMount(), typeof a.UNSAFE_componentWillMount == "function" && a.UNSAFE_componentWillMount()), typeof a.componentDidMount == "function" && (t.flags |= 4194308)) : (typeof a.componentDidMount == "function" && (t.flags |= 4194308), t.memoizedProps = r, t.memoizedState = l), a.props = r, a.state = l, a.context = o, r = c) : (typeof a.componentDidMount == "function" && (t.flags |= 4194308), r = !1);
		} else {
			a = t.stateNode, po(e, t), o = t.memoizedProps, u = bc(n, o), a.props = u, d = t.pendingProps, f = a.context, l = n.contextType, c = Di, typeof l == "object" && l && (c = Sa(l)), s = n.getDerivedStateFromProps, (l = typeof s == "function" || typeof a.getSnapshotBeforeUpdate == "function") || typeof a.UNSAFE_componentWillReceiveProps != "function" && typeof a.componentWillReceiveProps != "function" || (o !== d || f !== c) && yc(t, a, r, c), uo = !1, f = t.memoizedState, a.state = f, bo(t, r, a, i), yo();
			var p = t.memoizedState;
			o !== d || f !== p || uo || e !== null && e.dependencies !== null && ba(e.dependencies) ? (typeof s == "function" && (gc(t, n, s, r), p = t.memoizedState), (u = uo || vc(t, n, u, r, f, p, c) || e !== null && e.dependencies !== null && ba(e.dependencies)) ? (l || typeof a.UNSAFE_componentWillUpdate != "function" && typeof a.componentWillUpdate != "function" || (typeof a.componentWillUpdate == "function" && a.componentWillUpdate(r, p, c), typeof a.UNSAFE_componentWillUpdate == "function" && a.UNSAFE_componentWillUpdate(r, p, c)), typeof a.componentDidUpdate == "function" && (t.flags |= 4), typeof a.getSnapshotBeforeUpdate == "function" && (t.flags |= 1024)) : (typeof a.componentDidUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 4), typeof a.getSnapshotBeforeUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 1024), t.memoizedProps = r, t.memoizedState = p), a.props = r, a.state = p, a.context = c, r = u) : (typeof a.componentDidUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 4), typeof a.getSnapshotBeforeUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 1024), r = !1);
		}
		return a = r, Hc(e, t), r = !!(t.flags & 128), a || r ? (a = t.stateNode, n = r && typeof n.getDerivedStateFromError != "function" ? null : a.render(), t.flags |= 1, e !== null && r ? (t.child = co(t, e.child, null, i), t.child = co(t, null, n, i)) : Mc(e, t, n, i), t.memoizedState = a.state, e = t.child) : e = sl(e, t, i), e;
	}
	function Kc(e, t, n, r) {
		return la(), t.flags |= 256, Mc(e, t, n, r), t.child;
	}
	var qc = {
		dehydrated: null,
		treeContext: null,
		retryLane: 0,
		hydrationErrors: null
	};
	function Jc(e) {
		return {
			baseLanes: e,
			cachePool: Ga()
		};
	}
	function Yc(e, t, n) {
		return e = e === null ? 0 : e.childLanes & ~n, t && (e |= ld), e;
	}
	function Xc(e, t, n) {
		var r = t.pendingProps, i = !1, a = !!(t.flags & 128), o;
		if ((o = a) || (o = e !== null && e.memoizedState === null ? !1 : !!(Fo.current & 2)), o && (i = !0, t.flags &= -129), o = !!(t.flags & 32), t.flags &= -33, e === null) {
			if (U) {
				if (i ? Ao(t) : No(), (e = ta) ? (e = am(e, ra), e = e !== null && e.data !== "&" ? e : null, e !== null && (t.memoizedState = {
					dehydrated: e,
					treeContext: Ki === null ? null : {
						id: qi,
						overflow: Ji
					},
					retryLane: 536870912,
					hydrationErrors: null
				}, n = Ii(e), n.return = t, t.child = n, ea = t, ta = null)) : e = null, e === null) throw aa(t);
				return t.lanes = sm(e) ? 32 : 536870912, null;
			}
			return a = r.children, r = r.fallback, i ? (No(), i = t.mode, a = Qc({
				mode: "hidden",
				children: a
			}, i), r = Pi(r, i, n, null), a.return = t, r.return = t, a.sibling = r, t.child = a, r = t.child, r.memoizedState = Jc(n), r.childLanes = Yc(e, o, n), t.memoizedState = qc, Lc(null, r)) : (Ao(t), Zc(t, a));
		}
		var s = e.memoizedState;
		if (s !== null) {
			var c = s.dehydrated;
			if (c !== null) return el(e, t, a, o, r, c, s, n);
		}
		return i ? (No(), i = r.fallback, a = t.mode, s = e.child, c = s.sibling, r = ji(s, {
			mode: "hidden",
			children: r.children
		}), r.subtreeFlags = s.subtreeFlags & 1206910976, c === null ? (i = Pi(i, a, n, null), i.flags |= 2) : i = ji(c, i), i.return = t, r.return = t, r.sibling = i, t.child = r, Lc(null, r), r = t.child, i = e.child.memoizedState, i === null ? i = Jc(n) : (a = i.cachePool, a === null ? a = Ga() : (s = Oa._currentValue, a = a.parent === s ? a : {
			parent: s,
			pool: s
		}), i = {
			baseLanes: i.baseLanes | n,
			cachePool: a
		}), r.memoizedState = i, r.childLanes = Yc(e, o, n), t.memoizedState = qc, Lc(e.child, r)) : (Ao(t), n = e.child, e = n.sibling, n = ji(n, {
			mode: "visible",
			children: r.children
		}), n.return = t, n.sibling = null, e !== null && (o = t.deletions, o === null ? (t.deletions = [e], t.flags |= 16) : o.push(e)), t.child = n, t.memoizedState = null, n);
	}
	function Zc(e, t) {
		return t = Qc({
			mode: "visible",
			children: t
		}, e.mode), t.return = e, e.child = t;
	}
	function Qc(e, t) {
		return e = ki(22, e, null, t), e.lanes = 0, e;
	}
	function $c(e, t, n) {
		return co(t, e.child, null, n), e = Zc(t, t.pendingProps.children), e.flags |= 2, t.memoizedState = null, e;
	}
	function el(e, t, n, r, i, a, o, c) {
		if (n) return t.flags & 256 ? (Ao(t), t.flags &= -257, $c(e, t, c)) : t.memoizedState === null ? (No(), a = i.fallback, o = t.mode, i = Qc({
			mode: "visible",
			children: i.children
		}, o), a = Pi(a, o, c, null), a.flags |= 2, i.return = t, a.return = t, i.sibling = a, t.child = i, co(t, e.child, null, c), i = t.child, i.memoizedState = Jc(c), i.childLanes = Yc(e, r, c), t.memoizedState = qc, Lc(null, i)) : (No(), t.child = e.child, t.flags |= 128, null);
		if (Ao(t), sm(a)) {
			if (r = a.nextSibling && a.nextSibling.dataset, r) var l = r.dgst;
			return r = l, r !== "" && (i = Error(s(419)), i.stack = "", i.digest = r, da({
				value: i,
				source: null,
				stack: null
			})), $c(e, t, c);
		}
		if (jc || ya(e, t, c, !1), r = (c & e.childLanes) !== 0, jc || r) {
			if (Co.current !== null) return $c(e, t, c);
			if (r = $u, r !== null && (i = I(r, c), i !== 0 && i !== o.retryLane)) throw o.retryLane = i, wi(e, i), Pd(r, e, i), Ac;
			return om(a) || Kd(), $c(e, t, c);
		}
		return om(a) ? (t.flags |= 192, t.child = e.child, null) : (e = o.treeContext, ta = lm(a.nextSibling), ea = t, U = !0, na = null, ra = !1, e !== null && $i(t, e), t = Zc(t, i.children), t.flags |= 134221824, t);
	}
	function tl(e, t, n) {
		e.lanes |= t;
		var r = e.alternate;
		r !== null && (r.lanes |= t), _a(e.return, t, n);
	}
	function nl(e) {
		for (var t = null; e !== null;) {
			var n = e.alternate;
			n !== null && Ro(n) === null && (t = e), e = e.sibling;
		}
		return t;
	}
	function rl(e, t, n, r, i, a) {
		var o = e.memoizedState;
		o === null ? e.memoizedState = {
			isBackwards: t,
			rendering: null,
			renderingStartTime: 0,
			last: r,
			tail: n,
			tailMode: i,
			treeForkCount: a
		} : (o.isBackwards = t, o.rendering = null, o.renderingStartTime = 0, o.last = r, o.tail = n, o.tailMode = i, o.treeForkCount = a);
	}
	function il(e) {
		var t = e.child;
		for (e.child = null; t !== null;) {
			var n = t.sibling;
			t.sibling = e.child, e.child = t, t = n;
		}
	}
	function al(e, t, n) {
		var r = t.pendingProps, i = r.revealOrder, a = r.tail;
		r = r.children;
		var o = Fo.current;
		if (t.flags & 128) return Io(t, o), null;
		var s = !!(o & 2);
		if (s ? (o = o & 1 | 2, t.flags |= 128) : o &= 1, Io(t, o), i === "backwards" && e !== null ? (il(e), Mc(e, t, r, n), il(e)) : Mc(e, t, r, n), r = U ? Ui : 0, !s && e !== null && e.flags & 128) a: for (e = t.child; e !== null;) {
			if (e.tag === 13) e.memoizedState !== null && tl(e, n, t);
			else if (e.tag === 19) tl(e, n, t);
			else if (e.child !== null) {
				e.child.return = e, e = e.child;
				continue;
			}
			if (e === t) break a;
			for (; e.sibling === null;) {
				if (e.return === null || e.return === t) break a;
				e = e.return;
			}
			e.sibling.return = e.return, e = e.sibling;
		}
		switch (i) {
			case "backwards":
				n = nl(t.child), n === null ? (i = t.child, t.child = null) : (i = n.sibling, n.sibling = null, il(t)), rl(t, !0, i, null, a, r);
				break;
			case "unstable_legacy-backwards":
				for (n = null, i = t.child, t.child = null; i !== null;) {
					if (e = i.alternate, e !== null && Ro(e) === null) {
						t.child = i;
						break;
					}
					e = i.sibling, i.sibling = n, n = i, i = e;
				}
				rl(t, !0, n, null, a, r);
				break;
			case "together":
				rl(t, !1, null, null, void 0, r);
				break;
			case "independent":
				t.memoizedState = null;
				break;
			default: n = nl(t.child), n === null ? (i = t.child, t.child = null) : (i = n.sibling, n.sibling = null), rl(t, !1, i, n, a, r);
		}
		return t.child;
	}
	function ol(e, t, n) {
		var r = t.pendingProps;
		return ha(t, t.type, r.value), Mc(e, t, r.children, n), t.child;
	}
	function sl(e, t, n) {
		if (e !== null && (t.dependencies = e.dependencies), od |= t.lanes, (n & t.childLanes) === 0) {
			if (e !== null) {
				if (ya(e, t, n, !1), (n & t.childLanes) === 0) return null;
			} else return null;
		}
		if (e !== null && t.child !== e.child) throw Error(s(153));
		if (t.child !== null) {
			for (e = t.child, n = ji(e, e.pendingProps), t.child = n, n.return = t; e.sibling !== null;) e = e.sibling, n = n.sibling = ji(e, e.pendingProps), n.return = t;
			n.sibling = null;
		}
		return t.child;
	}
	function cl(e, t) {
		return (e.lanes & t) !== 0 || (e = e.dependencies, !!(e !== null && ba(e)));
	}
	function ll(e, t, n) {
		switch (t.tag) {
			case 3:
				Ae(t, t.stateNode.containerInfo), ha(t, Oa, e.memoizedState.cache), la();
				break;
			case 27:
			case 5:
				Me(t);
				break;
			case 4:
				Ae(t, t.stateNode.containerInfo);
				break;
			case 10:
				ha(t, t.type, t.memoizedProps.value);
				break;
			case 31:
				if (t.memoizedState !== null) return t.flags |= 128, jo(t), null;
				break;
			case 13:
				var r = t.memoizedState;
				if (r !== null) {
					if (r.dehydrated !== null) return Ao(t), t.flags |= 128, null;
					r = ya(e, t, n, !1);
					var i = t.child.childLanes;
					return r || (n & i) !== 0 ? Xc(e, t, n) : (Ao(t), e = sl(e, t, n), e === null ? null : e.sibling);
				}
				Ao(t);
				break;
			case 19:
				if (t.flags & 128) return al(e, t, n);
				if (i = !!(e.flags & 128), r = (n & t.childLanes) !== 0, r ||= (ya(e, t, n, !1), (n & t.childLanes) !== 0), i) {
					if (r) return al(e, t, n);
					t.flags |= 128;
				}
				if (i = t.memoizedState, i !== null && (i.rendering = null, i.tail = null, i.lastEffect = null), Io(t, Fo.current), r) break;
				return null;
			case 22: return t.lanes = 0, Ic(e, t, n, t.pendingProps);
			case 24: ha(t, Oa, e.memoizedState.cache);
		}
		return sl(e, t, n);
	}
	function ul(e, t, n) {
		if (e !== null) {
			if (e.memoizedProps !== t.pendingProps) jc = !0;
			else {
				if (!cl(e, n) && !(t.flags & 128)) return jc = !1, ll(e, t, n);
				jc = !!(e.flags & 131072);
			}
		} else jc = !1, U && t.flags & 1048576 && Xi(t, Ui, t.index);
		switch (t.lanes = 0, t.tag) {
			case 16:
				a: {
					var r = t.pendingProps;
					if (e = Qa(t.elementType), t.type = e, typeof e == "function") Ai(e) ? (r = bc(e, r), t.tag = 1, t = Gc(null, t, e, r, n)) : (t.tag = 0, t = Uc(null, t, e, r, n));
					else {
						if (e != null) {
							var i = e.$$typeof;
							if (i === le) {
								t.tag = 11, t = Nc(null, t, e, r, n);
								break a;
							}
							if (i === de) {
								t.tag = 14, t = Pc(null, t, e, r, n);
								break a;
							}
							if (i === ce) {
								t.tag = 10, t.type = e, t = ol(null, t, n);
								break a;
							}
						}
						throw t = be(e) || e, Error(s(306, t, ""));
					}
				}
				return t;
			case 0: return Uc(e, t, t.type, t.pendingProps, n);
			case 1: return r = t.type, i = bc(r, t.pendingProps), Gc(e, t, r, i, n);
			case 3:
				a: {
					if (Ae(t, t.stateNode.containerInfo), e === null) throw Error(s(387));
					r = t.pendingProps;
					var a = t.memoizedState;
					i = a.element, po(e, t), bo(t, r, null, n);
					var o = t.memoizedState;
					if (r = o.cache, ha(t, Oa, r), r !== a.cache && va(t, [Oa], n, !0), yo(), r = o.element, a.isDehydrated) {
						if (a = {
							element: r,
							isDehydrated: !1,
							cache: o.cache
						}, t.updateQueue.baseState = a, t.memoizedState = a, t.flags & 256) {
							t = Kc(e, t, r, n);
							break a;
						}
						if (r !== i) {
							i = zi(Error(s(424)), t), da(i), t = Kc(e, t, r, n);
							break a;
						}
						switch (e = t.stateNode.containerInfo, e.nodeType) {
							case 9:
								e = e.body;
								break;
							default: e = e.nodeName === "HTML" ? e.ownerDocument.body : e;
						}
						for (ta = lm(e.firstChild), ea = t, U = !0, na = null, ra = !0, n = lo(t, null, r, n), t.child = n; n;) n.flags = n.flags & -3 | 134221824, n = n.sibling;
					} else {
						if (la(), r === i) {
							t = sl(e, t, n);
							break a;
						}
						Mc(e, t, r, n);
					}
					t = t.child;
				}
				return t;
			case 26: return Hc(e, t), e === null ? (n = Nm(t.type, null, t.pendingProps, null)) ? t.memoizedState = n : U || (t.stateNode = fp(t.type, t.pendingProps, Oe.current, t)) : t.memoizedState = Nm(t.type, e.memoizedProps, t.pendingProps, e.memoizedState), null;
			case 27: return Me(t), e === null && U && (r = t.stateNode = hm(t.type, t.pendingProps, Oe.current), ea = t, ra = !0, i = ta, Sp(t.type) ? (um = i, ta = lm(r.firstChild)) : ta = i), Mc(e, t, t.pendingProps.children, n), Hc(e, t), e === null && (t.flags |= 4194304), t.child;
			case 5: return e === null && U && ((i = r = ta) && (r = rm(r, t.type, t.pendingProps, ra), r === null ? i = !1 : (t.stateNode = r, ea = t, ta = lm(r.firstChild), ra = !1, i = !0)), i || aa(t)), Me(t), i = t.type, a = t.pendingProps, o = e === null ? null : e.memoizedProps, r = a.children, pp(i, a) ? r = null : o !== null && pp(i, o) && (t.flags |= 32), t.memoizedState !== null && (i = Xo(e, t, $o, null, null, n), sh._currentValue = i), Hc(e, t), Mc(e, t, r, n), t.child;
			case 6: return e === null && U && ((e = n = ta) && (n = im(n, t.pendingProps, ra), n === null ? e = !1 : (t.stateNode = n, ea = t, ta = null, e = !0)), e || aa(t)), null;
			case 13: return Xc(e, t, n);
			case 4: return Ae(t, t.stateNode.containerInfo), r = t.pendingProps, e === null ? t.child = co(t, null, r, n) : Mc(e, t, r, n), t.child;
			case 11: return Nc(e, t, t.type, t.pendingProps, n);
			case 7: return r = t.pendingProps, Hc(e, t), Mc(e, t, r, n), t.child;
			case 8: return Mc(e, t, t.pendingProps.children, n), t.child;
			case 12: return Mc(e, t, t.pendingProps.children, n), t.child;
			case 10: return ol(e, t, n);
			case 9: return i = t.type._context, r = t.pendingProps.children, xa(t), i = Sa(i), r = r(i), t.flags |= 1, Mc(e, t, r, n), t.child;
			case 14: return Pc(e, t, t.type, t.pendingProps, n);
			case 15: return Fc(e, t, t.type, t.pendingProps, n);
			case 19: return al(e, t, n);
			case 31: return Vc(e, t, n);
			case 22: return Ic(e, t, n, t.pendingProps);
			case 24: return xa(t), r = Sa(Oa), e === null ? (i = Ua(), i === null && (i = $u, a = ka(), i.pooledCache = a, a.refCount++, a !== null && (i.pooledCacheLanes |= n), i = a), t.memoizedState = {
				parent: r,
				cache: i
			}, fo(t), ha(t, Oa, i)) : ((e.lanes & n) !== 0 && (po(e, t), bo(t, null, null, n), yo()), i = e.memoizedState, a = t.memoizedState, i.parent === r ? (r = a.cache, ha(t, Oa, r), r !== i.cache && va(t, [Oa], n, !0)) : (i = {
				parent: r,
				cache: r
			}, t.memoizedState = i, t.lanes === 0 && (t.memoizedState = t.updateQueue.baseState = i), ha(t, Oa, r))), Mc(e, t, t.pendingProps.children, n), t.child;
			case 30: return t.stateNode === null && (t.stateNode = {
				autoName: null,
				paired: null,
				clones: null,
				ref: null
			}), r = t.pendingProps, r.name != null && r.name !== "auto" ? t.flags |= e === null ? 18882560 : 18874368 : U && Zi(t), e !== null && e.memoizedProps.name !== r.name ? t.flags |= 4194816 : Hc(e, t), Mc(e, t, r.children, n), t.child;
			case 29: throw t.pendingProps;
		}
		throw Error(s(156, t.tag));
	}
	function dl(e) {
		e.flags |= 4;
	}
	function fl(e, t, n, r, i) {
		var a;
		if ((a = !!(e.mode & 32)) && (a = n === null ? Jm(t, r) : Jm(t, r) && (r.src !== n.src || r.srcSet !== n.srcSet)), a) {
			if (e.flags |= 16777216, (i & 335544128) === i) {
				if (e.stateNode.complete) e.flags |= 8192;
				else if (Ud()) e.flags |= 8192;
				else throw $a = Ya, qa;
			}
		} else e.flags &= -16777217;
	}
	function pl(e, t) {
		if (t.type !== "stylesheet" || t.state.loading & 4) e.flags &= -16777217;
		else if (e.flags |= 16777216, !Ym(t)) {
			if (Ud()) e.flags |= 8192;
			else throw $a = Ya, qa;
		}
	}
	function ml(e, t) {
		t !== null && (e.flags |= 4), e.flags & 16384 && (t = e.tag === 22 ? 536870912 : pt(), e.lanes |= t, ud |= t);
	}
	function hl(e, t) {
		if (!U) switch (e.tailMode) {
			case "visible": break;
			case "collapsed":
				for (var n = e.tail, r = null; n !== null;) n.alternate !== null && (r = n), n = n.sibling;
				r === null ? t || e.tail === null ? e.tail = null : e.tail.sibling = null : r.sibling = null;
				break;
			default:
				for (t = e.tail, n = null; t !== null;) t.alternate !== null && (n = t), t = t.sibling;
				n === null ? e.tail = null : n.sibling = null;
		}
	}
	function gl(e) {
		var t = e.alternate !== null && e.alternate.child === e.child, n = 0, r = 0;
		if (t) for (var i = e.child; i !== null;) n |= i.lanes | i.childLanes, r |= i.subtreeFlags & 1206910976, r |= i.flags & 1206910976, i.return = e, i = i.sibling;
		else for (i = e.child; i !== null;) n |= i.lanes | i.childLanes, r |= i.subtreeFlags, r |= i.flags, i.return = e, i = i.sibling;
		return e.subtreeFlags |= r, e.childLanes = n, t;
	}
	function _l(e, t, n) {
		var r = t.pendingProps;
		switch (Qi(t), t.tag) {
			case 16:
			case 15:
			case 0:
			case 11:
			case 7:
			case 8:
			case 12:
			case 9:
			case 14: return gl(t), null;
			case 1: return gl(t), null;
			case 3: return n = t.stateNode, r = null, e !== null && (r = e.memoizedState.cache), t.memoizedState.cache !== r && (t.flags |= 2048), ga(Oa), je(), n.pendingContext && (n.context = n.pendingContext, n.pendingContext = null), (e === null || e.child === null) && (ca(t) ? dl(t) : e === null || e.memoizedState.isDehydrated && !(t.flags & 256) || (t.flags |= 1024, ua())), gl(t), null;
			case 26:
				var i = t.type, a = t.memoizedState;
				return e === null ? (dl(t), a === null ? (gl(t), fl(t, i, null, r, n)) : (gl(t), pl(t, a))) : a ? a === e.memoizedState ? (gl(t), t.flags &= -16777217) : (dl(t), gl(t), pl(t, a)) : (e = e.memoizedProps, e !== r && dl(t), gl(t), fl(t, i, e, r, n)), null;
			case 27:
				if (Ne(t), n = Oe.current, i = t.type, e !== null && t.stateNode != null) e.memoizedProps !== r && dl(t);
				else {
					if (!r) {
						if (t.stateNode === null) throw Error(s(166));
						return gl(t), t.subtreeFlags &= -33554433, null;
					}
					e = Ee.current, ca(t) ? oa(t, e) : (e = hm(i, r, n), t.stateNode = e, dl(t));
				}
				return gl(t), t.subtreeFlags &= -33554433, null;
			case 5:
				if (Ne(t), i = t.type, e !== null && t.stateNode != null) e.memoizedProps !== r && dl(t);
				else {
					if (!r) {
						if (t.stateNode === null) throw Error(s(166));
						return gl(t), t.subtreeFlags &= -33554433, null;
					}
					if (a = Ee.current, ca(t)) oa(t, a);
					else {
						var o = lp(Oe.current);
						switch (a) {
							case 1:
								a = o.createElementNS("http://www.w3.org/2000/svg", i);
								break;
							case 2:
								a = o.createElementNS("http://www.w3.org/1998/Math/MathML", i);
								break;
							default: switch (i) {
								case "svg":
									a = o.createElementNS("http://www.w3.org/2000/svg", i);
									break;
								case "math":
									a = o.createElementNS("http://www.w3.org/1998/Math/MathML", i);
									break;
								case "script":
									a = o.createElement("div"), a.innerHTML = "<script><\/script>", a = a.removeChild(a.firstChild);
									break;
								case "select":
									a = typeof r.is == "string" ? o.createElement("select", { is: r.is }) : o.createElement("select"), r.multiple ? a.multiple = !0 : r.size && (a.size = r.size);
									break;
								default: a = typeof r.is == "string" ? o.createElement(i, { is: r.is }) : o.createElement(i);
							}
						}
						a[R] = t, a[z] = r;
						a: for (o = t.child; o !== null;) {
							if (o.tag === 5 || o.tag === 6) a.appendChild(o.stateNode);
							else if (o.tag !== 4 && o.tag !== 27 && o.child !== null) {
								o.child.return = o, o = o.child;
								continue;
							}
							if (o === t) break a;
							for (; o.sibling === null;) {
								if (o.return === null || o.return === t) break a;
								o = o.return;
							}
							o.sibling.return = o.return, o = o.sibling;
						}
						t.stateNode = a;
						a: switch (np(a, i, r), i) {
							case "button":
							case "input":
							case "select":
							case "textarea":
								r = !!r.autoFocus;
								break a;
							case "img":
								r = !0;
								break a;
							default: r = !1;
						}
						r && dl(t);
					}
				}
				return gl(t), t.subtreeFlags &= -33554433, fl(t, t.type, e === null ? null : e.memoizedProps, t.pendingProps, n), null;
			case 6:
				if (e && t.stateNode != null) e.memoizedProps !== r && dl(t);
				else {
					if (typeof r != "string" && t.stateNode === null) throw Error(s(166));
					if (e = Oe.current, ca(t)) {
						if (e = t.stateNode, n = t.memoizedProps, r = null, i = ea, i !== null) switch (i.tag) {
							case 27:
							case 5: r = i.memoizedProps;
						}
						e[R] = t, e = !!(e.nodeValue === n || r !== null && !0 === r.suppressHydrationWarning || ep(e.nodeValue, n)), e || aa(t, !0);
					} else e = lp(e).createTextNode(r), e[R] = t, t.stateNode = e;
				}
				return gl(t), null;
			case 31:
				if (n = t.memoizedState, e === null || e.memoizedState !== null) {
					if (r = ca(t), n !== null) {
						if (e === null) {
							if (!r) throw Error(s(318));
							if (e = t.memoizedState, e = e === null ? null : e.dehydrated, !e) throw Error(s(557));
							e[R] = t;
						} else la(), !(t.flags & 128) && (t.memoizedState = null), t.flags |= 4;
						gl(t), e = !1;
					} else n = ua(), e !== null && e.memoizedState !== null && (e.memoizedState.hydrationErrors = n), e = !0;
					if (!e) return t.flags & 256 ? (Po(t), t) : (Po(t), null);
					if (t.flags & 128) throw Error(s(558));
				}
				return gl(t), null;
			case 13:
				if (r = t.memoizedState, e === null || e.memoizedState !== null && e.memoizedState.dehydrated !== null) {
					if (i = ca(t), r !== null && r.dehydrated !== null) {
						if (e === null) {
							if (!i) throw Error(s(318));
							if (i = t.memoizedState, i = i === null ? null : i.dehydrated, !i) throw Error(s(317));
							i[R] = t;
						} else la(), !(t.flags & 128) && (t.memoizedState = null), t.flags |= 4;
						gl(t), i = !1;
					} else i = ua(), e !== null && e.memoizedState !== null && (e.memoizedState.hydrationErrors = i), i = !0;
					if (!i) return t.flags & 256 ? (Po(t), t) : (Po(t), null);
				}
				return Po(t), t.flags & 128 ? (t.lanes = n, t) : (n = r !== null, e = e !== null && e.memoizedState !== null, n && (r = t.child, i = null, r.alternate !== null && r.alternate.memoizedState !== null && r.alternate.memoizedState.cachePool !== null && (i = r.alternate.memoizedState.cachePool.pool), a = null, r.memoizedState !== null && r.memoizedState.cachePool !== null && (a = r.memoizedState.cachePool.pool), a !== i && (r.flags |= 2048)), n !== e && n && (t.child.flags |= 8192), ml(t, t.updateQueue), gl(t), null);
			case 4: return je(), e === null && Wf(t.stateNode.containerInfo), t.flags |= 67108864, gl(t), null;
			case 10: return ga(t.type), gl(t), null;
			case 19:
				if (Lo(t), r = t.memoizedState, r === null) return gl(t), null;
				if (i = !!(t.flags & 128), a = r.rendering, a === null) {
					if (i) hl(r, !1);
					else {
						if (ad !== 0 || e !== null && e.flags & 128) for (e = t.child; e !== null;) {
							if (a = Ro(e), a !== null) {
								for (t.flags |= 128, hl(r, !1), e = a.updateQueue, t.updateQueue = e, ml(t, e), t.subtreeFlags = 0, e = n, n = t.child; n !== null;) Mi(n, e), n = n.sibling;
								return Io(t, Fo.current & 1 | 2), U && Yi(t, r.treeForkCount), t.child;
							}
							e = e.sibling;
						}
						r.tail !== null && We() > gd && (t.flags |= 128, i = !0, hl(r, !1), t.lanes = 4194304);
					}
				} else {
					if (!i) {
						if (e = Ro(a), e !== null) {
							if (t.flags |= 128, i = !0, e = e.updateQueue, t.updateQueue = e, ml(t, e), hl(r, !0), r.tail === null && r.tailMode !== "collapsed" && r.tailMode !== "visible" && !a.alternate && !U) return gl(t), null;
						} else 2 * We() - r.renderingStartTime > gd && n !== 536870912 && (t.flags |= 128, i = !0, hl(r, !1), t.lanes = 4194304);
					}
					r.isBackwards ? (a.sibling = t.child, t.child = a) : (e = r.last, e === null ? t.child = a : e.sibling = a, r.last = a);
				}
				if (r.tail !== null) {
					e = r.tail;
					a: {
						for (n = e; n !== null;) {
							if (n.alternate !== null) {
								n = !1;
								break a;
							}
							n = n.sibling;
						}
						n = !0;
					}
					return r.rendering = e, r.tail = e.sibling, r.renderingStartTime = We(), e.sibling = null, a = Fo.current, a = i ? a & 1 | 2 : a & 1, r.tailMode === "visible" || r.tailMode === "collapsed" || !n || U ? Io(t, a) : (n = a, M(Oo, t), M(Fo, n), ko === null && (ko = t)), U && Yi(t, r.treeForkCount), e;
				}
				return gl(t), null;
			case 22:
			case 23: return Po(t), Do(), r = t.memoizedState !== null, e === null ? r && (t.flags |= 8192) : e.memoizedState !== null !== r && (t.flags |= 8192), r ? n & 536870912 && !(t.flags & 128) && (gl(t), t.subtreeFlags & 6 && (t.flags |= 8192)) : gl(t), n = t.updateQueue, n !== null && ml(t, n.retryQueue), n = null, e !== null && e.memoizedState !== null && e.memoizedState.cachePool !== null && (n = e.memoizedState.cachePool.pool), r = null, t.memoizedState !== null && t.memoizedState.cachePool !== null && (r = t.memoizedState.cachePool.pool), r !== n && (t.flags |= 2048), e !== null && Te(Ha), null;
			case 24: return n = null, e !== null && (n = e.memoizedState.cache), t.memoizedState.cache !== n && (t.flags |= 2048), ga(Oa), gl(t), null;
			case 25: return null;
			case 30: return t.flags |= 33554432, gl(t), null;
		}
		throw Error(s(156, t.tag));
	}
	function vl(e, t) {
		switch (Qi(t), t.tag) {
			case 1: return e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
			case 3: return ga(Oa), je(), e = t.flags, e & 65536 && !(e & 128) ? (t.flags = e & -65537 | 128, t) : null;
			case 26:
			case 27:
			case 5: return Ne(t), null;
			case 31:
				if (t.memoizedState !== null) {
					if (Po(t), t.alternate === null) throw Error(s(340));
					la();
				}
				return e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
			case 13:
				if (Po(t), e = t.memoizedState, e !== null && e.dehydrated !== null) {
					if (t.alternate === null) throw Error(s(340));
					la();
				}
				return e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
			case 19: return Lo(t), e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, e = t.memoizedState, e !== null && (e.rendering = null, e.tail = null), t.flags |= 4, t) : null;
			case 4: return je(), null;
			case 10: return ga(t.type), null;
			case 22:
			case 23: return Po(t), Do(), e !== null && Te(Ha), e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
			case 24: return ga(Oa), null;
			case 25: return null;
			default: return null;
		}
	}
	function yl(e, t) {
		switch (Qi(t), t.tag) {
			case 3:
				ga(Oa), je();
				break;
			case 26:
			case 27:
			case 5:
				Ne(t);
				break;
			case 4:
				je();
				break;
			case 31:
				t.memoizedState !== null && Po(t);
				break;
			case 13:
				Po(t);
				break;
			case 19:
				Lo(t);
				break;
			case 10:
				ga(t.type);
				break;
			case 22:
			case 23:
				Po(t), Do(), e !== null && Te(Ha);
				break;
			case 24: ga(Oa);
		}
	}
	function bl(e, t) {
		try {
			var n = t.updateQueue, r = n === null ? null : n.lastEffect;
			if (r !== null) {
				var i = r.next;
				n = i;
				do {
					if ((n.tag & e) === e) {
						r = void 0;
						var a = n.create, o = n.inst;
						r = a(), o.destroy = r;
					}
					n = n.next;
				} while (n !== i);
			}
		} catch (e) {
			Z(t, t.return, e);
		}
	}
	function xl(e, t, n) {
		try {
			var r = t.updateQueue, i = r === null ? null : r.lastEffect;
			if (i !== null) {
				var a = i.next;
				r = a;
				do {
					if ((r.tag & e) === e) {
						var o = r.inst, s = o.destroy;
						if (s !== void 0) {
							o.destroy = void 0, i = t;
							var c = n, l = s;
							try {
								l();
							} catch (e) {
								Z(i, c, e);
							}
						}
					}
					r = r.next;
				} while (r !== a);
			}
		} catch (e) {
			Z(t, t.return, e);
		}
	}
	function Sl(e) {
		var t = e.updateQueue;
		if (t !== null) {
			var n = e.stateNode;
			try {
				So(t, n);
			} catch (t) {
				Z(e, e.return, t);
			}
		}
	}
	function Cl(e, t, n) {
		n.props = bc(e.type, e.memoizedProps), n.state = e.memoizedState;
		try {
			n.componentWillUnmount();
		} catch (n) {
			Z(e, t, n);
		}
	}
	function wl(e, t) {
		try {
			var n = e.ref;
			if (n !== null) {
				switch (e.tag) {
					case 26:
					case 27:
					case 5:
						var r = e.stateNode;
						break;
					case 30:
						var i = e.stateNode, a = mi(e.memoizedProps, i);
						(i.ref === null || i.ref.name !== a) && (i.ref = Pp(a)), r = i.ref;
						break;
					case 7:
						if (e.stateNode === null) {
							var o = new Fp(e);
							h(e.child, !1, Qp, o, void 0, void 0), e.stateNode = o;
						}
						r = e.stateNode;
						break;
					default: r = e.stateNode;
				}
				typeof n == "function" ? e.refCleanup = n(r) : n.current = r;
			}
		} catch (n) {
			Z(e, t, n);
		}
	}
	function Tl(e, t) {
		var n = e.ref, r = e.refCleanup;
		if (n !== null) {
			if (typeof r == "function") try {
				r();
			} catch (n) {
				Z(e, t, n);
			} finally {
				e.refCleanup = null, e = e.alternate, e != null && (e.refCleanup = null);
			}
			else if (typeof n == "function") try {
				n(null);
			} catch (n) {
				Z(e, t, n);
			}
			else n.current = null;
		}
	}
	function El(e, t) {
		if ((e.tag === 5 || e.tag === 27 || e.tag === 6) && e.alternate === null && t !== null) for (var n = 0; n < t.length; n++) em(e.stateNode, t[n]);
	}
	function Dl(e) {
		for (var t = e.return; t !== null && (Al(t) && em(e.stateNode, t.stateNode), !kl(t));) t = t.return;
	}
	function Ol(e) {
		for (var t = e.return; t !== null && (Al(t) && tm(e.stateNode, t.stateNode), !kl(t));) t = t.return;
	}
	function kl(e) {
		return e.tag === 5 || e.tag === 3 || e.tag === 27;
	}
	function Al(e) {
		return e && e.tag === 7 && e.stateNode !== null;
	}
	function jl(e) {
		var t = e.type, n = e.memoizedProps, r = e.stateNode;
		try {
			a: switch (t) {
				case "button":
				case "input":
				case "select":
				case "textarea":
					n.autoFocus && r.focus();
					break a;
				case "img": n.src ? r.src = n.src : n.srcSet && (r.srcset = n.srcSet);
			}
		} catch (t) {
			Z(e, e.return, t);
		}
	}
	function Ml(e, t, n) {
		try {
			var r = e.stateNode;
			ip(r, e.type, n, t), r[z] = t;
		} catch (t) {
			Z(e, e.return, t);
		}
	}
	function Nl(e) {
		return e.tag === 5 || e.tag === 3 || e.tag === 26 || e.tag === 27 && Sp(e.type) || e.tag === 4;
	}
	function Pl(e) {
		a: for (;;) {
			for (; e.sibling === null;) {
				if (e.return === null || Nl(e.return)) return null;
				e = e.return;
			}
			for (e.sibling.return = e.return, e = e.sibling; e.tag !== 5 && e.tag !== 6 && e.tag !== 18;) {
				if (e.tag === 27 && Sp(e.type) || e.flags & 2 || e.child === null || e.tag === 4) continue a;
				e.child.return = e, e = e.child;
			}
			if (!(e.flags & 2)) return e.stateNode;
		}
	}
	function Fl(e, t, n, r) {
		var i = e.tag;
		if (i === 5 || i === 6) i = e.stateNode, t ? (n.nodeType === 9 ? n.body : n.nodeName === "HTML" ? n.ownerDocument.body : n).insertBefore(i, t) : (t = n.nodeType === 9 ? n.body : n.nodeName === "HTML" ? n.ownerDocument.body : n, t.appendChild(i), n = n._reactRootContainer, n != null || t.onclick !== null || (t.onclick = gn)), El(e, r), B = !0;
		else if (i !== 4 && (i === 27 && (El(e, r), r = null, Sp(e.type) && (n = e.stateNode, t = null)), e = e.child, e !== null)) for (Fl(e, t, n, r), e = e.sibling; e !== null;) Fl(e, t, n, r), e = e.sibling;
	}
	function Il(e, t, n, r) {
		var i = e.tag;
		if (i === 5 || i === 6) i = e.stateNode, t ? n.insertBefore(i, t) : n.appendChild(i), El(e, r), B = !0;
		else if (i !== 4 && (i === 27 && (El(e, r), r = null, Sp(e.type) && (n = e.stateNode)), e = e.child, e !== null)) for (Il(e, t, n, r), e = e.sibling; e !== null;) Il(e, t, n, r), e = e.sibling;
	}
	function Ll(e) {
		var t = e.stateNode, n = e.memoizedProps;
		try {
			for (var r = e.type, i = t.attributes; i.length;) t.removeAttributeNode(i[0]);
			np(t, r, n), t[R] = e, t[z] = n;
		} catch (t) {
			Z(e, e.return, t);
		}
	}
	var Rl = !1, zl = null;
	function Bl(e) {
		(e.tag === 30 || e.subtreeFlags & 33554432) && (Rl = !0);
	}
	var Vl = null;
	function Hl() {
		var e = Vl;
		return Vl = null, e;
	}
	var Ul = 0;
	function Wl(e, t, n, r, i) {
		return Ul = 0, Gl(e.child, t, n, r, i);
	}
	function Gl(e, t, n, r, i) {
		for (var a = !1; e !== null;) {
			if (e.tag === 5) {
				var o = e.stateNode;
				if (r !== null) {
					var s = Op(o);
					r.push(s), s.view && (a = !0);
				} else a || Op(o).view && (a = !0);
				Rl = !0, Tp(o, Ul === 0 ? t : t + "_" + Ul, n), Ul++;
			} else e.tag === 22 && e.memoizedState !== null || e.tag === 30 && i || Gl(e.child, t, n, r, i) && (a = !0);
			e = e.sibling;
		}
		return a;
	}
	function Kl(e, t) {
		for (; e !== null;) e.tag === 5 ? Ep(e.stateNode, e.memoizedProps) : e.tag === 22 && e.memoizedState !== null || e.tag === 30 && t || Kl(e.child, t), e = e.sibling;
	}
	function ql(e) {
		if (e.subtreeFlags & 18874368) for (e = e.child; e !== null;) {
			if ((e.tag !== 22 || e.memoizedState === null) && (ql(e), e.tag === 30 && e.flags & 18874368 && e.stateNode.paired)) {
				var t = e.memoizedProps;
				if (t.name == null || t.name === "auto") throw Error(s(544));
				var n = t.name;
				t = gi(t.default, t.share), t !== "none" && (Wl(e, n, t, null, !1) || Kl(e.child, !1));
			}
			e = e.sibling;
		}
	}
	function Jl(e, t) {
		if (e.tag === 30) {
			var n = e.stateNode, r = e.memoizedProps, i = mi(r, n), a = gi(r.default, n.paired ? r.share : r.enter);
			a === "none" ? ql(e) : Wl(e, i, a, null, !1) ? (ql(e), n.paired || t || Nd(e, r.onEnter)) : Kl(e.child, !1);
		} else if (e.subtreeFlags & 33554432) for (e = e.child; e !== null;) Jl(e, t), e = e.sibling;
		else ql(e);
	}
	function Yl(e) {
		if (zl !== null && zl.size !== 0) {
			var t = zl;
			if (e.subtreeFlags & 18874368) for (e = e.child; e !== null;) {
				if (e.tag !== 22 || e.memoizedState === null) {
					if (e.tag === 30 && e.flags & 18874368) {
						var n = e.memoizedProps, r = n.name;
						if (r != null && r !== "auto") {
							var i = t.get(r);
							if (i !== void 0) {
								var a = gi(n.default, n.share);
								if (a !== "none" && (Wl(e, r, a, null, !1) ? (a = e.stateNode, i.paired = a, a.paired = i, Nd(e, n.onShare)) : Kl(e.child, !1)), t.delete(r), t.size === 0) break;
							}
						}
					}
					Yl(e);
				}
				e = e.sibling;
			}
		}
	}
	function Xl(e) {
		if (e.tag === 30) {
			var t = e.memoizedProps, n = mi(t, e.stateNode), r = zl === null ? void 0 : zl.get(n), i = gi(t.default, r === void 0 ? t.exit : t.share);
			i !== "none" && (Wl(e, n, i, null, !1) ? r === void 0 ? Nd(e, t.onExit) : (i = e.stateNode, r.paired = i, i.paired = r, zl.delete(n), Nd(e, t.onShare)) : Kl(e.child, !1)), zl !== null && Yl(e);
		} else if (e.subtreeFlags & 33554432) for (e = e.child; e !== null;) Xl(e), e = e.sibling;
		else zl !== null && Yl(e);
	}
	function Zl(e) {
		for (e = e.child; e !== null;) {
			if (e.tag === 30) {
				var t = e.memoizedProps, n = mi(t, e.stateNode);
				t = gi(t.default, t.update), e.flags &= -5, t !== "none" && Wl(e, n, t, e.memoizedState = [], !1);
			} else e.subtreeFlags & 33554432 && Zl(e);
			e = e.sibling;
		}
	}
	function Ql(e) {
		if (e.subtreeFlags & 18874368) for (e = e.child; e !== null;) {
			if (e.tag !== 22 || e.memoizedState === null) {
				if (e.tag === 30 && e.flags & 18874368) {
					var t = e.stateNode;
					t.paired !== null && (t.paired = null, Kl(e.child, !1));
				}
				Ql(e);
			}
			e = e.sibling;
		}
	}
	function $l(e) {
		if (e.tag === 30) e.stateNode.paired = null, Kl(e.child, !1), Ql(e);
		else if (e.subtreeFlags & 33554432) for (e = e.child; e !== null;) $l(e), e = e.sibling;
		else Ql(e);
	}
	function eu(e) {
		for (e = e.child; e !== null;) e.tag === 30 ? Kl(e.child, !1) : e.subtreeFlags & 33554432 && eu(e), e = e.sibling;
	}
	function tu(e, t, n, r, i, a, o) {
		for (var s = !1; t !== null;) {
			if (t.tag === 5) {
				var c = t.stateNode;
				if (a !== null && Ul < a.length) {
					var l = a[Ul], u = Op(c);
					(l.view || u.view) && (s = !0);
					var d;
					if (d = !(e.flags & 4)) {
						if (u.clip) d = !0;
						else {
							d = l.rect;
							var f = u.rect;
							d = d.y !== f.y || d.x !== f.x || d.height !== f.height || d.width !== f.width;
						}
					}
					d && (e.flags |= 4), u.abs ? u = !l.abs : (l = l.rect, u = u.rect, u = l.height !== u.height || l.width !== u.width), u && (e.flags |= 32);
				} else e.flags |= 32;
				e.flags & 4 && Tp(c, Ul === 0 ? n : n + "_" + Ul, i), s && e.flags & 4 || (Vl === null && (Vl = []), Vl.push(c, Ul === 0 ? r : r + "_" + Ul, t.memoizedProps)), Ul++;
			} else (t.tag !== 22 || t.memoizedState === null) && (t.tag === 30 && o ? e.flags |= t.flags & 32 : tu(e, t.child, n, r, i, a, o) && (s = !0));
			t = t.sibling;
		}
		return s;
	}
	function nu(e, t) {
		for (e = e.child; e !== null;) {
			if (e.tag === 30) {
				var n = e.memoizedProps, r = e.stateNode, i = mi(n, r), a = gi(n.default, n.update);
				if (t) {
					r = r.clones;
					var o = r === null ? null : r.map(kp);
				} else o = e.memoizedState, e.memoizedState = null;
				r = e;
				var s = e.child;
				Ul = 0, i = tu(r, s, i, i, a, o, !1), e.flags & 4 && i && (t || Nd(e, n.onUpdate));
			} else e.subtreeFlags & 33554432 && nu(e, t);
			e = e.sibling;
		}
	}
	var ru = !1, K = !1, iu = !1, au = !1, ou = typeof WeakSet == "function" ? WeakSet : Set, su = null, cu = !1, lu = !1, uu = !1, du = !1;
	function fu(e, t, n) {
		if (e = e.containerInfo, sp = gh, e = Wr(e), Gr(e)) {
			if ("selectionStart" in e) var r = {
				start: e.selectionStart,
				end: e.selectionEnd
			};
			else a: {
				r = (r = e.ownerDocument) && r.defaultView || window;
				var i = r.getSelection && r.getSelection();
				if (i && i.rangeCount !== 0) {
					r = i.anchorNode;
					var a = i.anchorOffset, o = i.focusNode;
					i = i.focusOffset;
					try {
						r.nodeType, o.nodeType;
					} catch {
						r = null;
						break a;
					}
					var s = 0, c = -1, l = -1, u = 0, d = 0, f = e, p = null;
					b: for (;;) {
						for (var m; f !== r || a !== 0 && f.nodeType !== 3 || (c = s + a), f !== o || i !== 0 && f.nodeType !== 3 || (l = s + i), f.nodeType === 3 && (s += f.nodeValue.length), (m = f.firstChild) !== null;) p = f, f = m;
						for (;;) {
							if (f === e) break b;
							if (p === r && ++u === a && (c = s), p === o && ++d === i && (l = s), (m = f.nextSibling) !== null) break;
							f = p, p = f.parentNode;
						}
						f = m;
					}
					r = c === -1 || l === -1 ? null : {
						start: c,
						end: l
					};
				} else r = null;
			}
			r ||= {
				start: 0,
				end: 0
			};
		} else r = null;
		for (cp = {
			focusedElem: e,
			selectionRange: r
		}, gh = !1, n = (n & 335544064) === n, su = t, t = n ? 9270 : 1024; su !== null;) {
			if (e = su, n && (r = e.deletions, r !== null)) for (a = 0; a < r.length; a++) n && Xl(r[a]);
			if (e.alternate === null && e.flags & 2) n && Bl(e), pu(n);
			else {
				if (e.tag === 22) {
					if (r = e.alternate, e.memoizedState !== null) {
						r !== null && r.memoizedState === null && n && Xl(r), pu(n);
						continue;
					}
					if (r !== null && r.memoizedState !== null) {
						n && Bl(e), pu(n);
						continue;
					}
				}
				r = e.child, (e.subtreeFlags & t) !== 0 && r !== null ? (r.return = e, su = r) : (n && Zl(e), pu(n));
			}
		}
		zl = null;
	}
	function pu(e) {
		for (; su !== null;) {
			var t = su, n = e, r = t.alternate, i = t.flags;
			switch (t.tag) {
				case 0:
				case 11:
				case 15: break;
				case 1:
					if (i & 1024 && r !== null) {
						n = void 0, i = r.memoizedProps, r = r.memoizedState;
						var a = t.stateNode;
						try {
							var o = bc(t.type, i);
							n = a.getSnapshotBeforeUpdate(o, r), a.__reactInternalSnapshotBeforeUpdate = n;
						} catch (e) {
							Z(t, t.return, e);
						}
					}
					break;
				case 3:
					if (i & 1024) {
						if (r = t.stateNode.containerInfo, n = r.nodeType, n === 9) nm(r);
						else if (n === 1) switch (r.nodeName) {
							case "HEAD":
							case "HTML":
							case "BODY":
								nm(r);
								break;
							default: r.textContent = "";
						}
					}
					break;
				case 5:
				case 26:
				case 27:
				case 6:
				case 4:
				case 17: break;
				case 30:
					n && r !== null && (n = mi(r.memoizedProps, r.stateNode), i = t.memoizedProps, i = gi(i.default, i.update), i !== "none" && Wl(r, n, i, r.memoizedState = [], !0));
					break;
				default: if (i & 1024) throw Error(s(163));
			}
			if (r = t.sibling, r !== null) {
				r.return = t.return, su = r;
				break;
			}
			su = t.return;
		}
	}
	function mu(e, t, n) {
		var r = n.flags;
		switch (n.tag) {
			case 0:
			case 11:
			case 15:
				Pu(e, n), r & 4 && bl(5, n);
				break;
			case 1:
				if (Pu(e, n), r & 4) {
					if (e = n.stateNode, t === null) try {
						e.componentDidMount();
					} catch (e) {
						Z(n, n.return, e);
					}
					else {
						var i = bc(n.type, t.memoizedProps);
						t = t.memoizedState;
						try {
							e.componentDidUpdate(i, t, e.__reactInternalSnapshotBeforeUpdate);
						} catch (e) {
							Z(n, n.return, e);
						}
					}
				}
				r & 64 && Sl(n), r & 512 && wl(n, n.return);
				break;
			case 3:
				if (Pu(e, n), r & 64 && (e = n.updateQueue, e !== null)) {
					if (t = null, n.child !== null) switch (n.child.tag) {
						case 27:
						case 5:
							t = n.child.stateNode;
							break;
						case 1: t = n.child.stateNode;
					}
					try {
						So(e, t);
					} catch (e) {
						Z(n, n.return, e);
					}
				}
				break;
			case 27: t === null && r & 4 && Ll(n);
			case 26:
			case 5:
				Pu(e, n), t === null && r & 4 && jl(n), r & 512 && wl(n, n.return);
				break;
			case 12:
				Pu(e, n);
				break;
			case 31:
				Pu(e, n), r & 4 && Cu(e, n);
				break;
			case 13:
				Pu(e, n), r & 4 && wu(e, n), r & 64 && (e = n.memoizedState, e !== null && (e = e.dehydrated, e !== null && (n = _f.bind(null, n), cm(e, n))));
				break;
			case 22:
				if (r = n.memoizedState !== null || ru, !r) {
					var a = t !== null && t.memoizedState !== null || K;
					t = ru, i = K, ru = r, (K = a) && !i ? (r = 2, n.subtreeFlags & 8772 && (r |= 1), Iu(e, n, r)) : Pu(e, n), ru = t, K = i;
				}
				break;
			case 30:
				Pu(e, n), r & 512 && wl(n, n.return);
				break;
			case 7: r & 512 && wl(n, n.return);
			default: Pu(e, n);
		}
	}
	function hu(e, t) {
		for (e = e.child; e !== null;) gu(e, t), e = e.sibling;
	}
	function gu(e, t) {
		switch (e.tag) {
			case 5:
			case 26:
				try {
					var n = e.stateNode;
					if (t) {
						var r = n.style;
						typeof r.setProperty == "function" ? r.setProperty("display", "none", "important") : r.display = "none";
					} else {
						var i = e.stateNode, a = e.memoizedProps.style, o = a != null && a.hasOwnProperty("display") ? a.display : null;
						i.style.display = o == null || typeof o == "boolean" ? "" : ("" + o).trim();
					}
				} catch (t) {
					Z(e, e.return, t);
				}
				_u(e, t);
				break;
			case 6:
				try {
					e.stateNode.nodeValue = t ? "" : e.memoizedProps, B = !0;
				} catch (t) {
					Z(e, e.return, t);
				}
				break;
			case 18:
				try {
					var s = e.stateNode;
					t ? wp(s, !0) : wp(e.stateNode, !1);
				} catch (t) {
					Z(e, e.return, t);
				}
				break;
			case 22:
			case 23:
				e.memoizedState === null && hu(e, t);
				break;
			default: hu(e, t);
		}
	}
	function _u(e, t) {
		if (e.subtreeFlags & 67108864) for (e = e.child; e !== null;) {
			a: {
				var n = e, r = t;
				switch (n.tag) {
					case 4:
						gu(n, r);
						break a;
					case 22:
						n.memoizedState === null && _u(n, r);
						break a;
					default: _u(n, r);
				}
			}
			e = e.sibling;
		}
	}
	function vu(e) {
		var t = e.alternate;
		t !== null && (e.alternate = null, vu(t)), e.child = null, e.deletions = null, e.sibling = null, e.tag === 5 && (t = e.stateNode, t !== null && At(t)), e.stateNode = null, e.return = null, e.dependencies = null, e.memoizedProps = null, e.memoizedState = null, e.pendingProps = null, e.stateNode = null, e.updateQueue = null;
	}
	var yu = null, bu = !1;
	function xu(e, t, n) {
		for (n = n.child; n !== null;) Su(e, t, n), n = n.sibling;
	}
	function Su(e, t, n) {
		if (et && typeof et.onCommitFiberUnmount == "function") try {
			et.onCommitFiberUnmount($e, n);
		} catch {}
		switch (n.tag) {
			case 26:
				K || Tl(n, t), xu(e, t, n), n.memoizedState ? n.memoizedState.count-- : n.stateNode && !K && (n = n.stateNode, n.parentNode.removeChild(n));
				break;
			case 27:
				K || Tl(n, t), Ol(n);
				var r = yu, i = bu;
				Sp(n.type) && (yu = n.stateNode, bu = !1), xu(e, t, n), gm(n.stateNode, n.type, n.memoizedProps), yu = r, bu = i;
				break;
			case 5: K || Tl(n, t), Ol(n);
			case 6:
				if (n.tag === 6 && Ol(n), r = yu, i = bu, yu = null, xu(e, t, n), yu = r, bu = i, yu !== null) {
					if (bu) try {
						(yu.nodeType === 9 ? yu.body : yu.nodeName === "HTML" ? yu.ownerDocument.body : yu).removeChild(n.stateNode), B = !0;
					} catch (e) {
						Z(n, t, e);
					}
					else try {
						yu.removeChild(n.stateNode), B = !0;
					} catch (e) {
						Z(n, t, e);
					}
				}
				break;
			case 18:
				yu !== null && (bu ? (e = yu, Cp(e.nodeType === 9 ? e.body : e.nodeName === "HTML" ? e.ownerDocument.body : e, n.stateNode), Hh(e)) : Cp(yu, n.stateNode));
				break;
			case 4:
				r = yu, i = bu, yu = n.stateNode.containerInfo, bu = !0, xu(e, t, n), yu = r, bu = i;
				break;
			case 0:
			case 11:
			case 14:
			case 15:
				xl(2, n, t), K || xl(4, n, t), xu(e, t, n);
				break;
			case 1:
				K || (Tl(n, t), r = n.stateNode, typeof r.componentWillUnmount == "function" && Cl(n, t, r)), xu(e, t, n);
				break;
			case 21:
				xu(e, t, n);
				break;
			case 22:
				K = (r = K) || n.memoizedState !== null, xu(e, t, n), K = r;
				break;
			case 30:
				Tl(n, t), xu(e, t, n);
				break;
			case 7:
				K || Tl(n, t), xu(e, t, n);
				break;
			default: xu(e, t, n);
		}
	}
	function Cu(e, t) {
		if (t.memoizedState === null && (e = t.alternate, e !== null && (e = e.memoizedState, e !== null))) {
			e = e.dehydrated;
			try {
				Hh(e);
			} catch (e) {
				Z(t, t.return, e);
			}
		}
	}
	function wu(e, t) {
		if (t.memoizedState === null && (e = t.alternate, e !== null && (e = e.memoizedState, e !== null && (e = e.dehydrated, e !== null)))) try {
			Hh(e);
		} catch (e) {
			Z(t, t.return, e);
		}
	}
	function Tu(e) {
		switch (e.tag) {
			case 31:
			case 13:
			case 19:
				var t = e.stateNode;
				return t === null && (t = e.stateNode = new ou()), t;
			case 22: return e = e.stateNode, t = e._retryCache, t === null && (t = e._retryCache = new ou()), t;
			default: throw Error(s(435, e.tag));
		}
	}
	function Eu(e, t) {
		var n = Tu(e);
		t.forEach(function(t) {
			if (!n.has(t)) {
				n.add(t);
				var r = vf.bind(null, e, t);
				t.then(r, r);
			}
		});
	}
	function Du(e, t, n) {
		var r = t.deletions;
		if (r !== null) for (var i = 0; i < r.length; i++) {
			var a = r[i], o = e, c = t, l = c;
			a: for (; l !== null;) {
				switch (l.tag) {
					case 27:
						if (Sp(l.type)) {
							yu = l.stateNode, bu = !1;
							break a;
						}
						break;
					case 5:
						yu = l.stateNode, bu = !1;
						break a;
					case 3:
					case 4:
						yu = l.stateNode.containerInfo, bu = !0;
						break a;
				}
				l = l.return;
			}
			if (yu === null) throw Error(s(160));
			Su(o, c, a), yu = null, bu = !1, o = a.alternate, o !== null && (o.return = null), a.return = null;
		}
		if (t.subtreeFlags & 13886) for (t = t.child; t !== null;) ku(t, e, n), t = t.sibling;
	}
	var Ou = null;
	function ku(e, t, n) {
		var r = e.alternate, i = e.flags;
		switch (e.tag) {
			case 0:
			case 11:
			case 14:
			case 15:
				if (i & 4 && (r = e.updateQueue, r = r === null ? null : r.events, r !== null)) for (var a = 0; a < r.length; a++) {
					var o = r[a];
					o.ref.impl = o.nextImpl;
				}
				Du(t, e, n), Au(e), i & 4 && (xl(3, e, e.return), bl(3, e), xl(5, e, e.return));
				break;
			case 1:
				Du(t, e, n), Au(e), i & 512 && (K || r === null || Tl(r, r.return)), i & 64 && ru && (e = e.updateQueue, e !== null && (t = e.callbacks, t !== null && (n = e.shared.hiddenCallbacks, e.shared.hiddenCallbacks = n === null ? t : n.concat(t))));
				break;
			case 26:
				if (a = Ou, Du(t, e, n), Au(e), i & 512 && (K || r === null || Tl(r, r.return)), i & 4) {
					if (i = r === null ? null : r.memoizedState, n = e.memoizedState, r === null) {
						if (n === null) {
							if (e.stateNode === null) {
								if (ru) e.stateNode = fp(e.type, e.memoizedProps, t.containerInfo, e);
								else {
									a: {
										t = e.type, n = e.memoizedProps, i = a.ownerDocument || a;
										b: switch (t) {
											case "title":
												r = i.getElementsByTagName("title")[0], (!r || r[Ot] || r[R] || r.namespaceURI === "http://www.w3.org/2000/svg" || r.hasAttribute("itemprop")) && (r = i.createElement(t), i.head.insertBefore(r, i.querySelector("head > title"))), np(r, t, n), r[R] = e, Ft(r), t = r;
												break a;
											case "link":
												if (a = Gm("link", "href", i).get(t + (n.href || ""))) {
													for (o = 0; o < a.length; o++) if (r = a[o], r.getAttribute("href") === (n.href == null || n.href === "" ? null : n.href) && r.getAttribute("rel") === (n.rel == null ? null : n.rel) && r.getAttribute("title") === (n.title == null ? null : n.title) && r.getAttribute("crossorigin") === (n.crossOrigin == null ? null : n.crossOrigin)) {
														a.splice(o, 1);
														break b;
													}
												}
												r = i.createElement(t), np(r, t, n), i.head.appendChild(r);
												break;
											case "meta":
												if (a = Gm("meta", "content", i).get(t + (n.content || ""))) {
													for (o = 0; o < a.length; o++) if (r = a[o], r.getAttribute("content") === (n.content == null ? null : "" + n.content) && r.getAttribute("name") === (n.name == null ? null : n.name) && r.getAttribute("property") === (n.property == null ? null : n.property) && r.getAttribute("http-equiv") === (n.httpEquiv == null ? null : n.httpEquiv) && r.getAttribute("charset") === (n.charSet == null ? null : n.charSet)) {
														a.splice(o, 1);
														break b;
													}
												}
												r = i.createElement(t), np(r, t, n), i.head.appendChild(r);
												break;
											default: throw Error(s(468, t));
										}
										r[R] = e, Ft(r), t = r;
									}
									e.stateNode = t;
								}
							} else ru || Km(a, e.type, e.stateNode);
						} else e.stateNode = Bm(a, n, e.memoizedProps);
					} else i === n ? n === null && e.stateNode !== null && Ml(e, e.memoizedProps, r.memoizedProps) : (i === null ? (t = r.stateNode, t === null || K || t.parentNode.removeChild(t)) : i.count--, n === null ? ru || Km(a, e.type, e.stateNode) : Bm(a, n, e.memoizedProps));
				}
				break;
			case 27:
				Du(t, e, n), Au(e), i & 512 && (K || r === null || Tl(r, r.return)), r !== null && i & 4 && Ml(e, e.memoizedProps, r.memoizedProps);
				break;
			case 5:
				if (a = iu, iu = !1, Du(t, e, n), iu = a, Au(e), i & 512 && (K || r === null || Tl(r, r.return)), e.flags & 32) {
					t = e.stateNode;
					try {
						cn(t, ""), B = !0;
					} catch (t) {
						Z(e, e.return, t);
					}
				}
				i & 4 && e.stateNode != null && (t = e.memoizedProps, Ml(e, t, r === null ? t : r.memoizedProps)), i & 1024 && (au = !0);
				break;
			case 6:
				if (Du(t, e, n), Au(e), i & 4) {
					if (e.stateNode === null) throw Error(s(162));
					t = e.memoizedProps, n = e.stateNode;
					try {
						n.nodeValue = t, B = !0;
					} catch (t) {
						Z(e, e.return, t);
					}
				}
				break;
			case 3:
				if (B = !1, Wm = null, a = Ou, Ou = bm(t.containerInfo), Du(t, e, n), Ou = a, Au(e), i & 4 && r !== null && r.memoizedState.isDehydrated) try {
					Hh(t.containerInfo);
				} catch (t) {
					Z(e, e.return, t);
				}
				au && (au = !1, ju(e)), B = !1;
				break;
			case 4:
				i = iu, iu = ru, r = Gt(), a = Ou, Ou = bm(e.stateNode.containerInfo), Du(t, e, n), Au(e), Ou = a, B && lu && (uu = !0), B = r, iu = i;
				break;
			case 12:
				Du(t, e, n), Au(e);
				break;
			case 31:
				Du(t, e, n), Au(e), i & 4 && (t = e.updateQueue, t !== null && (e.updateQueue = null, Eu(e, t)));
				break;
			case 13:
				Du(t, e, n), Au(e), e.child.flags & 8192 && e.memoizedState !== null != (r !== null && r.memoizedState !== null) && (md = We()), i & 4 && (t = e.updateQueue, t !== null && (e.updateQueue = null, Eu(e, t)));
				break;
			case 22:
				a = e.memoizedState !== null, o = r !== null && r.memoizedState !== null;
				var c = ru, l = K, u = iu;
				ru = c || a, iu = u || a, K = l || o, Du(t, e, n), K = l, iu = u, ru = c, Au(e), i & 8192 && (t = e.stateNode, t._visibility = a ? t._visibility & -2 : t._visibility | 1, !a || r === null || o || ru || K || (t = o || K, n = ru, r = K, ru = a || ru, K = t, Fu(e, 2), ru = n, K = r), !a && iu || hu(e, a)), i & 4 && (t = e.updateQueue, t !== null && (n = t.retryQueue, n !== null && (t.retryQueue = null, Eu(e, n))));
				break;
			case 19:
				Du(t, e, n), Au(e), i & 4 && (t = e.updateQueue, t !== null && (e.updateQueue = null, Eu(e, t)));
				break;
			case 30:
				i & 512 && (K || r === null || Tl(r, r.return)), i = Gt(), a = lu, o = (n & 335544064) === n, c = e.memoizedProps, lu = o && gi(c.default, c.update) !== "none", Du(t, e, n), Au(e), o && r !== null && B && (e.flags |= 4), lu = a, B = i;
				break;
			case 21: break;
			case 7: i & 512 && (K || r === null || Tl(r, r.return)), r && r.stateNode !== null && (r.stateNode._fragmentFiber = e);
			default: Du(t, e, n), Au(e);
		}
	}
	function Au(e) {
		var t = e.flags;
		if (t & 2) {
			try {
				for (var n, r = e.return; r !== null;) {
					if (Nl(r)) {
						n = r;
						break;
					}
					r = r.return;
				}
				r = null;
				for (var i = e.return; i !== null;) {
					if (Al(i)) {
						var a = i.stateNode;
						r === null ? r = [a] : r.push(a);
					}
					if (kl(i)) break;
					i = i.return;
				}
				var o = r;
				if (n == null) throw Error(s(160));
				switch (n.tag) {
					case 27:
						var c = n.stateNode;
						Il(e, Pl(e), c, o);
						break;
					case 5:
						var l = n.stateNode;
						n.flags & 32 && (cn(l, ""), n.flags &= -33), Il(e, Pl(e), l, o);
						break;
					case 3:
					case 4:
						var u = n.stateNode.containerInfo;
						Fl(e, Pl(e), u, o);
						break;
					default: throw Error(s(161));
				}
			} catch (t) {
				Z(e, e.return, t);
			}
			e.flags &= -3;
		}
		t & 4096 && (e.flags &= -4097);
	}
	function ju(e) {
		if (e.subtreeFlags & 1024) for (e = e.child; e !== null;) {
			var t = e;
			ju(t), t.tag === 5 && t.flags & 1024 && (t = t.stateNode, gh = !0, t.reset(), gh = !1), e = e.sibling;
		}
	}
	function Mu(e, t) {
		if (t.subtreeFlags & 9270) for (t = t.child; t !== null;) Nu(t, e), t = t.sibling;
		else nu(t, !1);
	}
	function Nu(e, t) {
		var n = e.alternate;
		if (n === null) Jl(e, !1);
		else switch (e.tag) {
			case 3:
				if (du = cu = !1, Hl(), Mu(t, e), !cu && !uu) {
					if (e = Vl, e !== null) for (var r = 0; r < e.length; r += 3) {
						n = e[r];
						var i = e[r + 1];
						Ep(n, e[r + 2]), n = n.ownerDocument.documentElement, n !== null && n.animate({
							opacity: [0, 0],
							pointerEvents: ["none", "none"]
						}, {
							duration: 0,
							fill: "forwards",
							pseudoElement: "::view-transition-group(" + i + ")"
						});
					}
					e = t.containerInfo, e = e.nodeType === 9 ? e.documentElement : e.ownerDocument.documentElement, e !== null && e.style.viewTransitionName === "" && (e.style.viewTransitionName = "none", e.animate({
						opacity: [0, 0],
						pointerEvents: ["none", "none"]
					}, {
						duration: 0,
						fill: "forwards",
						pseudoElement: "::view-transition-group(root)"
					}), e.animate({
						width: [0, 0],
						height: [0, 0]
					}, {
						duration: 0,
						fill: "forwards",
						pseudoElement: "::view-transition"
					})), du = !0;
				}
				Vl = null;
				break;
			case 5:
				Mu(t, e);
				break;
			case 4:
				r = cu, cu = !1, Mu(t, e), cu && (uu = !0), cu = r;
				break;
			case 22:
				e.memoizedState === null && (n.memoizedState === null ? Mu(t, e) : Jl(e, !1));
				break;
			case 30:
				r = cu, i = Hl(), cu = !1, Mu(t, e), cu && (e.flags |= 4);
				var a = e.memoizedProps, o = e.stateNode;
				t = mi(a, o), o = mi(n.memoizedProps, o);
				var s = gi(a.default, a.update);
				s === "none" ? t = !1 : (a = n.memoizedState, n.memoizedState = null, n = e.child, Ul = 0, t = tu(e, n, t, o, s, a, !0), Ul !== (a === null ? 0 : a.length) && (e.flags |= 32)), e.flags & 4 && t ? (Nd(e, e.memoizedProps.onUpdate), Vl = i) : i !== null && (i.push.apply(i, Vl), Vl = i), cu = e.flags & 32 ? !0 : r;
				break;
			default: Mu(t, e);
		}
	}
	function Pu(e, t) {
		if (t.subtreeFlags & 8772) for (t = t.child; t !== null;) mu(e, t.alternate, t), t = t.sibling;
	}
	function Fu(e, t) {
		for (e = e.child; e !== null;) {
			var n = e, r = t;
			switch (n.tag) {
				case 0:
				case 11:
				case 14:
				case 15:
					xl(4, n, n.return), Fu(n, r);
					break;
				case 1:
					Tl(n, n.return);
					var i = n.stateNode;
					typeof i.componentWillUnmount == "function" && Cl(n, n.return, i), Fu(n, r);
					break;
				case 27: r & 2 && gm(n.stateNode, n.type, n.memoizedProps);
				case 5:
					Tl(n, n.return), n.tag !== 5 && n.tag !== 27 || Ol(n), Fu(n, r);
					break;
				case 6:
					Ol(n);
					break;
				case 26:
					Tl(n, n.return), i = n.stateNode, n.memoizedState !== null || i === null || K || i.parentNode.removeChild(i), Fu(n, r);
					break;
				case 22:
					n.memoizedState === null && Fu(n, r);
					break;
				case 30:
					Tl(n, n.return), Fu(n, r);
					break;
				case 7: Tl(n, n.return);
				default: Fu(n, r);
			}
			e = e.sibling;
		}
	}
	function Iu(e, t, n) {
		for (n = t.subtreeFlags & 8772 ? n : n & -2, t = t.child; t !== null;) {
			var r = t.alternate, i = e, a = t, o = a.flags, s = !!(n & 1);
			switch (a.tag) {
				case 0:
				case 11:
				case 15:
					Iu(i, a, n), bl(4, a);
					break;
				case 1:
					if (Iu(i, a, n), r = a, i = r.stateNode, typeof i.componentDidMount == "function") try {
						i.componentDidMount();
					} catch (e) {
						Z(r, r.return, e);
					}
					if (r = a, i = r.updateQueue, i !== null) {
						var c = r.stateNode;
						try {
							var l = i.shared.hiddenCallbacks;
							if (l !== null) for (i.shared.hiddenCallbacks = null, i = 0; i < l.length; i++) xo(l[i], c);
						} catch (e) {
							Z(r, r.return, e);
						}
					}
					s && o & 64 && Sl(a), wl(a, a.return);
					break;
				case 27: n & 2 && Ll(a);
				case 5:
					a.tag !== 5 && a.tag !== 27 || Dl(a), Iu(i, a, n), s && r === null && o & 4 && jl(a), wl(a, a.return);
					break;
				case 6:
					Dl(a);
					break;
				case 26:
					c = a.stateNode, a.memoizedState !== null || c === null || ru || Km(bm(c.ownerDocument), a.type, c), Iu(i, a, n), s && r === null && o & 4 && jl(a), wl(a, a.return);
					break;
				case 12:
					Iu(i, a, n);
					break;
				case 31:
					Iu(i, a, n), s && o & 4 && Cu(i, a);
					break;
				case 13:
					Iu(i, a, n), s && o & 4 && wu(i, a);
					break;
				case 22:
					a.memoizedState === null && Iu(i, a, n), wl(a, a.return);
					break;
				case 30:
					Iu(i, a, n), wl(a, a.return);
					break;
				case 7: wl(a, a.return);
				default: Iu(i, a, n);
			}
			t = t.sibling;
		}
	}
	function Lu(e, t) {
		var n = null;
		e !== null && e.memoizedState !== null && e.memoizedState.cachePool !== null && (n = e.memoizedState.cachePool.pool), e = null, t.memoizedState !== null && t.memoizedState.cachePool !== null && (e = t.memoizedState.cachePool.pool), e !== n && (e != null && e.refCount++, n != null && Aa(n));
	}
	function Ru(e, t) {
		e = null, t.alternate !== null && (e = t.alternate.memoizedState.cache), t = t.memoizedState.cache, t !== e && (t.refCount++, e != null && Aa(e));
	}
	function zu(e, t, n, r) {
		var i = (n & 335544064) === n;
		if (t.subtreeFlags & (i ? 10262 : 10256)) for (t = t.child; t !== null;) Bu(e, t, n, r), t = t.sibling;
		else i && eu(t);
	}
	function Bu(e, t, n, r) {
		var i = (n & 335544064) === n;
		i && t.alternate === null && t.return !== null && t.return.alternate !== null && $l(t);
		var a = t.flags;
		switch (t.tag) {
			case 0:
			case 11:
			case 15:
				zu(e, t, n, r), a & 2048 && bl(9, t);
				break;
			case 1:
				zu(e, t, n, r);
				break;
			case 3:
				zu(e, t, n, r), i && du && (e = e.containerInfo, e = e.nodeType === 9 ? e.body : e.nodeName === "HTML" ? e.ownerDocument.body : e, e.style.viewTransitionName === "root" && (e.style.viewTransitionName = ""), e = e.ownerDocument.documentElement, e !== null && e.style.viewTransitionName === "none" && (e.style.viewTransitionName = "")), a & 2048 && (a = null, t.alternate !== null && (a = t.alternate.memoizedState.cache), t = t.memoizedState.cache, t !== a && (t.refCount++, a != null && Aa(a)));
				break;
			case 12:
				if (a & 2048) {
					zu(e, t, n, r), a = t.stateNode;
					try {
						var o = t.memoizedProps, s = o.id, c = o.onPostCommit;
						typeof c == "function" && c(s, t.alternate === null ? "mount" : "update", a.passiveEffectDuration, -0);
					} catch (e) {
						Z(t, t.return, e);
					}
				} else zu(e, t, n, r);
				break;
			case 31:
				zu(e, t, n, r);
				break;
			case 13:
				zu(e, t, n, r);
				break;
			case 23: break;
			case 22:
				o = t.stateNode, s = t.alternate, t.memoizedState === null ? (i && s !== null && s.memoizedState !== null && $l(t), o._visibility & 2 ? zu(e, t, n, r) : (o._visibility |= 2, Vu(e, t, n, r, !!(t.subtreeFlags & 10256) || !1))) : (i && s !== null && s.memoizedState === null && $l(s), o._visibility & 2 ? zu(e, t, n, r) : Hu(e, t)), a & 2048 && Lu(s, t);
				break;
			case 24:
				zu(e, t, n, r), a & 2048 && Ru(t.alternate, t);
				break;
			case 30:
				i && (a = t.alternate, a !== null && (Kl(a.child, !0), Kl(t.child, !0))), zu(e, t, n, r);
				break;
			default: zu(e, t, n, r);
		}
	}
	function Vu(e, t, n, r, i) {
		for (i &&= !!(t.subtreeFlags & 10256) || !1, t = t.child; t !== null;) {
			var a = e, o = t, s = n, c = r, l = o.flags;
			switch (o.tag) {
				case 0:
				case 11:
				case 15:
					Vu(a, o, s, c, i), bl(8, o);
					break;
				case 23: break;
				case 22:
					var u = o.stateNode;
					o.memoizedState === null ? (u._visibility |= 2, Vu(a, o, s, c, i)) : u._visibility & 2 ? Vu(a, o, s, c, i) : Hu(a, o), i && l & 2048 && Lu(o.alternate, o);
					break;
				case 24:
					Vu(a, o, s, c, i), i && l & 2048 && Ru(o.alternate, o);
					break;
				default: Vu(a, o, s, c, i);
			}
			t = t.sibling;
		}
	}
	function Hu(e, t) {
		if (t.subtreeFlags & 10256) for (t = t.child; t !== null;) {
			var n = e, r = t, i = r.flags;
			switch (r.tag) {
				case 22:
					Hu(n, r), i & 2048 && Lu(r.alternate, r);
					break;
				case 24:
					Hu(n, r), i & 2048 && Ru(r.alternate, r);
					break;
				default: Hu(n, r);
			}
			t = t.sibling;
		}
	}
	var Uu = 8192;
	function Wu(e, t, n) {
		if (e.subtreeFlags & Uu) for (e = e.child; e !== null;) Gu(e, t, n), e = e.sibling;
	}
	function Gu(e, t, n) {
		switch (e.tag) {
			case 26:
				Wu(e, t, n), e.flags & Uu && (e.memoizedState === null ? (e = e.stateNode, (t & 335544128) === t && Zm(n, e)) : Qm(n, Ou, e.memoizedState, e.memoizedProps));
				break;
			case 5:
				Wu(e, t, n), e.flags & Uu && (e = e.stateNode, (t & 335544128) === t && Zm(n, e));
				break;
			case 3:
			case 4:
				var r = Ou;
				Ou = bm(e.stateNode.containerInfo), Wu(e, t, n), Ou = r;
				break;
			case 22:
				e.memoizedState === null && (r = e.alternate, r !== null && r.memoizedState !== null ? (r = Uu, Uu = 16777216, Wu(e, t, n), Uu = r) : Wu(e, t, n));
				break;
			case 30:
				if ((e.flags & Uu) !== 0 && (r = e.memoizedProps.name, r != null && r !== "auto")) {
					var i = e.stateNode;
					i.paired = null, zl === null && (zl = /* @__PURE__ */ new Map()), zl.set(r, i);
				}
				Wu(e, t, n);
				break;
			default: Wu(e, t, n);
		}
	}
	function Ku(e) {
		var t = e.alternate;
		if (t !== null && (e = t.child, e !== null)) {
			t.child = null;
			do
				t = e.sibling, e.sibling = null, e = t;
			while (e !== null);
		}
	}
	function qu(e) {
		var t = e.deletions;
		if (e.flags & 16) {
			if (t !== null) for (var n = 0; n < t.length; n++) {
				var r = t[n];
				su = r, Xu(r, e);
			}
			Ku(e);
		}
		if (e.subtreeFlags & 10256) for (e = e.child; e !== null;) Ju(e), e = e.sibling;
	}
	function Ju(e) {
		switch (e.tag) {
			case 0:
			case 11:
			case 15:
				qu(e), e.flags & 2048 && xl(9, e, e.return);
				break;
			case 3:
				qu(e);
				break;
			case 12:
				qu(e);
				break;
			case 22:
				var t = e.stateNode;
				e.memoizedState !== null && t._visibility & 2 && (e.return === null || e.return.tag !== 13) ? (t._visibility &= -3, Yu(e)) : qu(e);
				break;
			default: qu(e);
		}
	}
	function Yu(e) {
		var t = e.deletions;
		if (e.flags & 16) {
			if (t !== null) for (var n = 0; n < t.length; n++) {
				var r = t[n];
				su = r, Xu(r, e);
			}
			Ku(e);
		}
		for (e = e.child; e !== null;) {
			switch (t = e, t.tag) {
				case 0:
				case 11:
				case 15:
					xl(8, t, t.return), Yu(t);
					break;
				case 22:
					n = t.stateNode, n._visibility & 2 && (n._visibility &= -3, Yu(t));
					break;
				default: Yu(t);
			}
			e = e.sibling;
		}
	}
	function Xu(e, t) {
		for (; su !== null;) {
			var n = su;
			switch (n.tag) {
				case 0:
				case 11:
				case 15:
					xl(8, n, t);
					break;
				case 23:
				case 22:
					if (n.memoizedState !== null && n.memoizedState.cachePool !== null) {
						var r = n.memoizedState.cachePool.pool;
						r != null && r.refCount++;
					}
					break;
				case 24: Aa(n.memoizedState.cache);
			}
			if (r = n.child, r !== null) r.return = n, su = r;
			else a: for (n = e; su !== null;) {
				r = su;
				var i = r.sibling, a = r.return;
				if (vu(r), r === n) {
					su = null;
					break a;
				}
				if (i !== null) {
					i.return = a, su = i;
					break a;
				}
				su = a;
			}
		}
	}
	var Zu = {
		getCacheForType: function(e) {
			var t = Sa(Oa), n = t.data.get(e);
			return n === void 0 && (n = e(), t.data.set(e, n)), n;
		},
		cacheSignal: function() {
			return Sa(Oa).controller.signal;
		}
	}, Qu = typeof WeakMap == "function" ? WeakMap : Map, q = 0, $u = null, J = null, Y = 0, X = 0, ed = null, td = !1, nd = !1, rd = !1, id = 0, ad = 0, od = 0, sd = 0, cd = 0, ld = 0, ud = 0, dd = null, fd = null, pd = !1, md = 0, hd = 0, gd = Infinity, _d = null, vd = null, yd = 0, bd = null, xd = null, Sd = 0, Cd = 0, wd = null, Td = null, Ed = null, Dd = null, Od = null, kd = 0, Ad = null;
	function jd() {
		return q & 2 && Y !== 0 ? Y & -Y : k.T === null ? bt() : Pf();
	}
	function Md() {
		if (ld === 0) {
			if (!(Y & 536870912) || U) {
				var e = ot;
				ot <<= 1, !(ot & 3932160) && (ot = 262144), ld = e;
			} else ld = 536870912;
		}
		return e = Oo.current, e !== null && (e.flags |= 32), ld;
	}
	function Nd(e, t) {
		if (t != null) {
			var n = e.stateNode, r = n.ref;
			r === null && (r = n.ref = Pp(mi(e.memoizedProps, n))), Dd === null && (Dd = []), Dd.push(t.bind(null, r));
		}
	}
	function Pd(e, t, n) {
		(e === $u && (X === 2 || X === 9) || e.cancelPendingCommit !== null) && (Vd(e, 0), Rd(e, Y, ld, !1)), ht(e, n), q & 2 && e === $u || (e === $u && (!(q & 2) && (sd |= n), ad === 4 && Rd(e, Y, ld, !1)), Ef(e));
	}
	function Fd(e, t, n) {
		if (q & 6) throw Error(s(327));
		var r = !n && !(t & 127) && (t & e.expiredLanes) === 0 || ut(e, t), i = r ? Yd(e, t) : qd(e, t, !0), a = r;
		do {
			if (i === 0) {
				nd && !r && Rd(e, t, 0, !1);
				break;
			}
			if (n = e.current.alternate, a && !Ld(n)) i = qd(e, t, !1), a = !1;
			else {
				if (i === 2) {
					if (a = t, e.errorRecoveryDisabledLanes & a) var o = 0;
					else o = e.pendingLanes & -536870913, o = o === 0 ? o & 536870912 ? 536870912 : 0 : o;
					if (o !== 0) {
						t = o;
						a: {
							var c = e;
							i = dd;
							var l = c.current.memoizedState.isDehydrated;
							if (l && (Vd(c, o).flags |= 256), o = qd(c, o, !1), o !== 2 && o !== 6) {
								if (rd && !l) {
									c.errorRecoveryDisabledLanes |= a, sd |= a, i = 4;
									break a;
								}
								a = fd, fd = i, a !== null && (fd === null ? fd = a : fd.push.apply(fd, a));
							}
							i = o;
						}
						if (a = !1, i !== 2) continue;
					}
				}
				if (i === 1) {
					Vd(e, 0), Rd(e, t, 0, !0);
					break;
				}
				a: {
					switch (r = e, a = i, a) {
						case 0:
						case 1: throw Error(s(345));
						case 4: if ((t & 4194048) !== t && (t & 62914560) !== t) break;
						case 6:
							Rd(r, t, ld, !td);
							break a;
						case 2:
							fd = null;
							break;
						case 3:
						case 5: break;
						default: throw Error(s(329));
					}
					if ((t & 62914560) === t && (i = md + 300 - We(), 10 < i)) {
						if (Rd(r, t, ld, !td), lt(r, 0, !0) !== 0) break a;
						Sd = t, r.timeoutHandle = gp(Id.bind(null, r, n, fd, _d, pd, t, ld, sd, ud, td, a, "Throttled", -0, 0), i);
						break a;
					}
					Id(r, n, fd, _d, pd, t, ld, sd, ud, td, a, null, -0, 0);
				}
				break;
			}
		} while (1);
		Ef(e);
	}
	function Id(e, t, n, r, i, a, o, s, c, l, u, d, f, p) {
		e.timeoutHandle = -1;
		var m = t.subtreeFlags, h = (a & 335544064) === a;
		d = null, (h || m & 8192 || (m & 16785408) == 16785408) && (d = {
			stylesheets: null,
			count: 0,
			imgCount: 0,
			imgBytes: 0,
			suspenseyImages: [],
			waitingForImages: !0,
			waitingForViewTransition: !1,
			unsuspend: gn
		}, zl = null, Gu(t, a, d), h && (m = d, h = e.containerInfo, h = (h.nodeType === 9 ? h : h.ownerDocument).__reactViewTransition, h != null && (m.count++, m.waitingForViewTransition = !0, m = nh.bind(m), h.finished.then(m, m))), m = (a & 62914560) === a ? md - We() : (a & 4194048) === a ? hd - We() : 0, m = eh(d, m), m !== null) ? (Sd = a, e.cancelPendingCommit = m(nf.bind(null, e, t, a, n, r, i, o, s, c, l, u, d, null, f, p)), Rd(e, a, o, !l)) : nf(e, t, a, n, r, i, o, s, c, l, u, d);
	}
	function Ld(e) {
		for (var t = e;;) {
			var n = t.tag;
			if ((n === 0 || n === 11 || n === 15) && t.flags & 16384 && (n = t.updateQueue, n !== null && (n = n.stores, n !== null))) for (var r = 0; r < n.length; r++) {
				var i = n[r], a = i.getSnapshot;
				i = i.value;
				try {
					if (!Rr(a(), i)) return !1;
				} catch {
					return !1;
				}
			}
			if (n = t.child, t.subtreeFlags & 16384 && n !== null) n.return = t, t = n;
			else {
				if (t === e) break;
				for (; t.sibling === null;) {
					if (t.return === null || t.return === e) return !0;
					t = t.return;
				}
				t.sibling.return = t.return, t = t.sibling;
			}
		}
		return !0;
	}
	function Rd(e, t, n, r) {
		t = dt(e, t), t &= ~cd, t &= ~sd, e.suspendedLanes |= t, e.pingedLanes &= ~t, r && (e.warmLanes |= t), r = e.expirationTimes;
		for (var i = t; 0 < i;) {
			var a = 31 - tt(i), o = 1 << a;
			r[a] = -1, i &= ~o;
		}
		n !== 0 && _t(e, n, t);
	}
	function zd() {
		return q & 6 ? !0 : (Df(0, !1), !1);
	}
	function Bd() {
		if (J !== null) {
			if (X === 0) var e = J.return;
			else e = J, ma = pa = null, ns(e), no = null, ro = 0, e = J;
			for (; e !== null;) yl(e.alternate, e), e = e.return;
			J = null;
		}
	}
	function Vd(e, t) {
		var n = e.timeoutHandle;
		return n !== -1 && (e.timeoutHandle = -1, _p(n)), n = e.cancelPendingCommit, n !== null && (e.cancelPendingCommit = null, n()), Sd = 0, Bd(), $u = e, J = n = ji(e.current, null), Y = t, X = 0, ed = null, td = !1, nd = ut(e, t), rd = !1, ud = ld = cd = sd = od = ad = 0, fd = dd = null, pd = !1, id = dt(e, t), xi(), n;
	}
	function Hd(e, t) {
		W = null, k.H = fc, t === Ka || t === Ja ? (t = eo(), X = 3) : t === qa ? (t = eo(), X = 4) : X = t === Ac ? 8 : typeof t == "object" && t && typeof t.then == "function" ? 6 : 1, ed = t, J === null && (ad = 1, wc(e, zi(t, e.current)));
	}
	function Ud() {
		var e = Oo.current;
		return e === null ? !0 : (Y & 4194048) === Y ? ko === null : (Y & 62914560) === Y || Y & 536870912 ? e === ko : !1;
	}
	function Wd() {
		var e = k.H;
		return k.H = fc, e === null ? fc : e;
	}
	function Gd() {
		var e = k.A;
		return k.A = Zu, e;
	}
	function Kd() {
		ad = 4, td || (Y & 4194048) !== Y && Oo.current !== null || (nd = !0), !(od & 134217727) && !(sd & 134217727) || $u === null || Rd($u, Y, ld, !1);
	}
	function qd(e, t, n) {
		var r = q;
		q |= 2;
		var i = Wd(), a = Gd();
		($u !== e || Y !== t) && (_d = null, Vd(e, t)), t = !1;
		var o = ad;
		a: do
			try {
				if (X !== 0 && J !== null) {
					var s = J, c = ed;
					switch (X) {
						case 8:
							Bd(), o = 6;
							break a;
						case 3:
						case 2:
						case 9:
						case 6:
							Oo.current === null && (t = !0);
							var l = X;
							if (X = 0, ed = null, $d(e, s, c, l), n && nd) {
								o = 0;
								break a;
							}
							break;
						default: l = X, X = 0, ed = null, $d(e, s, c, l);
					}
				}
				Jd(), o = ad;
				break;
			} catch (t) {
				Hd(e, t);
			}
		while (1);
		return t && e.shellSuspendCounter++, ma = pa = null, q = r, k.H = i, k.A = a, J === null && ($u = null, Y = 0, xi()), o;
	}
	function Jd() {
		for (; J !== null;) Zd(J);
	}
	function Yd(e, t) {
		var n = q;
		q |= 2;
		var r = Wd(), i = Gd();
		$u !== e || Y !== t ? (_d = null, gd = We() + 500, Vd(e, t)) : nd = ut(e, t);
		a: do
			try {
				if (X !== 0 && J !== null) {
					t = J;
					var a = ed;
					b: switch (X) {
						case 1:
							X = 0, ed = null, $d(e, t, a, 1);
							break;
						case 2:
						case 9:
							if (Xa(a)) {
								X = 0, ed = null, Qd(t);
								break;
							}
							t = function() {
								X !== 2 && X !== 9 || $u !== e || (X = 7), Ef(e);
							}, a.then(t, t);
							break a;
						case 3:
							X = 7;
							break a;
						case 4:
							X = 5;
							break a;
						case 7:
							Xa(a) ? (X = 0, ed = null, Qd(t)) : (X = 0, ed = null, $d(e, t, a, 7));
							break;
						case 5:
							var o = null;
							switch (J.tag) {
								case 26: o = J.memoizedState;
								case 5:
								case 27:
									var c = J;
									if (o ? Ym(o) : c.stateNode.complete) {
										X = 0, ed = null;
										var l = c.sibling;
										if (l !== null) J = l;
										else {
											var u = c.return;
											u === null ? J = null : (J = u, ef(u));
										}
										break b;
									}
							}
							X = 0, ed = null, $d(e, t, a, 5);
							break;
						case 6:
							X = 0, ed = null, $d(e, t, a, 6);
							break;
						case 8:
							Bd(), ad = 6;
							break a;
						default: throw Error(s(462));
					}
				}
				Xd();
				break;
			} catch (t) {
				Hd(e, t);
			}
		while (1);
		return ma = pa = null, k.H = r, k.A = i, q = n, J === null ? ($u = null, Y = 0, xi(), ad) : 0;
	}
	function Xd() {
		for (; J !== null && !He();) Zd(J);
	}
	function Zd(e) {
		var t = ul(e.alternate, e, id);
		e.memoizedProps = e.pendingProps, t === null ? ef(e) : J = t;
	}
	function Qd(e) {
		var t = e, n = t.alternate;
		switch (t.tag) {
			case 15:
			case 0:
				t = Wc(n, t, t.pendingProps, t.type, void 0, Y);
				break;
			case 11:
				t = Wc(n, t, t.pendingProps, t.type.render, t.ref, Y);
				break;
			case 5:
				ns(t);
				var r = t;
				r === ea && (U ? (sa(r), r.tag === 5 && r.stateNode != null && (ta = r.stateNode)) : (sa(r), U = !0));
			default: yl(n, t), t = J = Mi(t, id), t = ul(n, t, id);
		}
		e.memoizedProps = e.pendingProps, t === null ? ef(e) : J = t;
	}
	function $d(e, t, n, r) {
		ma = pa = null, ns(t), no = null, ro = 0;
		var i = t.return;
		try {
			if (kc(e, i, t, n, Y)) {
				ad = 1, wc(e, zi(n, e.current)), J = null;
				return;
			}
		} catch (t) {
			if (i !== null) throw J = i, t;
			ad = 1, wc(e, zi(n, e.current)), J = null;
			return;
		}
		t.flags & 32768 ? (U || r === 1 ? e = !0 : nd || Y & 536870912 ? e = !1 : (td = e = !0, (r === 2 || r === 9 || r === 3 || r === 6) && (r = Oo.current, r !== null && r.tag === 13 && (r.flags |= 16384))), tf(t, e)) : ef(t);
	}
	function ef(e) {
		var t = e;
		do {
			if (t.flags & 32768) {
				tf(t, td);
				return;
			}
			e = t.return;
			var n = _l(t.alternate, t, id);
			if (n !== null) {
				J = n;
				return;
			}
			if (t = t.sibling, t !== null) {
				J = t;
				return;
			}
			J = t = e;
		} while (t !== null);
		ad === 0 && (ad = 5);
	}
	function tf(e, t) {
		do {
			var n = vl(e.alternate, e);
			if (n !== null) {
				n.flags &= 32767, J = n;
				return;
			}
			if (n = e.return, n !== null && (n.flags |= 32768, n.subtreeFlags = 0, n.deletions = null), !t && (e = e.sibling, e !== null)) {
				J = e;
				return;
			}
			J = e = n;
		} while (e !== null);
		ad = 6, J = null;
	}
	function nf(e, t, n, r, i, a, o, c, l, u, d, f) {
		e.cancelPendingCommit = null;
		do
			df();
		while (yd !== 0);
		if (q & 6) throw Error(s(327));
		if (t !== null) {
			if (t === e.current) throw Error(s(177));
			e === $u && (J = $u = null, Y = 0), xd = t, bd = e, Sd = n, wd = i, Td = r, rf(e, t, n, o, c, l, f);
		}
	}
	function rf(e, t, n, r, i, a, o) {
		var s = t.lanes | t.childLanes;
		if (Cd = s, s |= bi, gt(e, n, s, r, i, a), Dd = null, (n & 335544064) === n ? (Od = Na(e), r = 10262) : (Od = null, r = 10256), (t.subtreeFlags & r) !== 0 || (t.flags & r) !== 0 ? (e.callbackNode = null, e.callbackPriority = 0, yf(Je, function() {
			return ff(), null;
		})) : (e.callbackNode = null, e.callbackPriority = 0), Rl = !1, r = !!(t.flags & 13878), t.subtreeFlags & 13878 || r) {
			r = k.T, k.T = null, i = A.p, A.p = 2, a = q, q |= 4;
			try {
				fu(e, t, n);
			} finally {
				q = a, A.p = i, k.T = r;
			}
		}
		yd = 1, Rl ? Ed = Mp(o, e.containerInfo, Od, sf, cf, of, lf, ff, af, null, null) : (sf(), cf(), lf());
	}
	function af(e) {
		if (yd !== 0) {
			var t = bd.onRecoverableError;
			t(e, { componentStack: null });
		}
	}
	function of() {
		yd === 3 && (yd = 0, Nu(xd, bd), yd = 4);
	}
	function sf() {
		if (yd === 1) {
			yd = 0;
			var e = bd, t = xd, n = Sd, r = !!(t.flags & 13878);
			if (t.subtreeFlags & 13878 || r) {
				r = k.T, k.T = null;
				var i = A.p;
				A.p = 2;
				var a = q;
				q |= 4;
				try {
					lu = uu = !1, ku(t, e, n), n = cp;
					var o = Wr(e.containerInfo), s = n.focusedElem, c = n.selectionRange;
					if (o !== s && s && s.ownerDocument && Ur(s.ownerDocument.documentElement, s)) {
						if (c !== null && Gr(s)) {
							var l = c.start, u = c.end;
							if (u === void 0 && (u = l), "selectionStart" in s) s.selectionStart = l, s.selectionEnd = Math.min(u, s.value.length);
							else {
								var d = s.ownerDocument || document, f = d && d.defaultView || window;
								if (f.getSelection) {
									var p = f.getSelection(), m = s.textContent.length, h = Math.min(c.start, m), g = c.end === void 0 ? h : Math.min(c.end, m);
									!p.extend && h > g && (o = g, g = h, h = o);
									var _ = Hr(s, h), v = Hr(s, g);
									if (_ && v && (p.rangeCount !== 1 || p.anchorNode !== _.node || p.anchorOffset !== _.offset || p.focusNode !== v.node || p.focusOffset !== v.offset)) {
										var y = d.createRange();
										y.setStart(_.node, _.offset), p.removeAllRanges(), h > g ? (p.addRange(y), p.extend(v.node, v.offset)) : (y.setEnd(v.node, v.offset), p.addRange(y));
									}
								}
							}
						}
						for (d = [], p = s; p = p.parentNode;) p.nodeType === 1 && d.push({
							element: p,
							left: p.scrollLeft,
							top: p.scrollTop
						});
						for (typeof s.focus == "function" && s.focus(), s = 0; s < d.length; s++) {
							var b = d[s];
							b.element.scrollLeft = b.left, b.element.scrollTop = b.top;
						}
					}
					gh = !!sp, cp = sp = null;
				} finally {
					q = a, A.p = i, k.T = r;
				}
			}
			e.current = t, yd = 2;
		}
	}
	function cf() {
		if (yd === 2) {
			yd = 0;
			var e = bd, t = xd, n = !!(t.flags & 8772);
			if (t.subtreeFlags & 8772 || n) {
				n = k.T, k.T = null;
				var r = A.p;
				A.p = 2;
				var i = q;
				q |= 4;
				try {
					mu(e, t.alternate, t);
				} finally {
					q = i, A.p = r, k.T = n;
				}
			}
			yd = 3;
		}
	}
	function lf() {
		if (yd === 4 || yd === 3) {
			yd = 0;
			var e = Ed;
			Ed = null, Ue();
			var t = bd, n = xd, r = Sd, i = Td, a = (r & 335544064) === r ? 10262 : 10256;
			if ((n.subtreeFlags & a) !== 0 || (n.flags & a) !== 0 ? yd = 5 : (yd = 0, xd = bd = null, uf(t, t.pendingLanes)), a = t.pendingLanes, a === 0 && (vd = null), yt(r), n = n.stateNode, et && typeof et.onCommitFiberRoot == "function") try {
				et.onCommitFiberRoot($e, n, void 0, (n.current.flags & 128) == 128);
			} catch {}
			if (i !== null) {
				n = k.T, a = A.p, A.p = 2, k.T = null;
				try {
					for (var o = t.onRecoverableError, s = 0; s < i.length; s++) {
						var c = i[s];
						o(c.value, { componentStack: c.stack });
					}
				} finally {
					k.T = n, A.p = a;
				}
			}
			if (i = Dd, o = Od, Od = null, i !== null && (Dd = null, o === null && (o = []), e !== null)) for (c = 0; c < i.length; c++) n = (0, i[c])(o), n !== void 0 && e.finished.finally(n);
			Sd & 3 && df(), Ef(t), a = t.pendingLanes, r & 261930 && a & 42 ? t === Ad ? kd++ : (kd = 0, Ad = t) : (kd = 0, Ad = null), Df(0, !1);
		}
	}
	function uf(e, t) {
		(e.pooledCacheLanes &= t) === 0 && (t = e.pooledCache, t != null && (e.pooledCache = null, Aa(t)));
	}
	function df() {
		return Ed !== null && (Ed.skipTransition(), Ed = null), sf(), cf(), lf(), ff();
	}
	function ff() {
		if (yd !== 5) return !1;
		var e = bd, t = Cd;
		Cd = 0;
		var n = yt(Sd), r = k.T, i = A.p;
		try {
			A.p = 32 > n ? 32 : n, k.T = null, n = wd, wd = null;
			var a = bd, o = Sd;
			if (yd = 0, xd = bd = null, Sd = 0, q & 6) throw Error(s(331));
			var c = q;
			if (q |= 4, Ju(a.current), Bu(a, a.current, o, n), q = c, Df(0, !1), et && typeof et.onPostCommitFiberRoot == "function") try {
				et.onPostCommitFiberRoot($e, a);
			} catch {}
			return !0;
		} finally {
			A.p = i, k.T = r, uf(e, t);
		}
	}
	function pf(e, t, n) {
		t = zi(n, t), t = Ec(e.stateNode, t, 2), e = ho(e, t, 2), e !== null && (ht(e, 2), Ef(e));
	}
	function Z(e, t, n) {
		if (e.tag === 3) pf(e, e, n);
		else for (; t !== null;) {
			if (t.tag === 3) {
				pf(t, e, n);
				break;
			}
			if (t.tag === 1) {
				var r = t.stateNode;
				if (typeof t.type.getDerivedStateFromError == "function" || typeof r.componentDidCatch == "function" && (vd === null || !vd.has(r))) {
					e = zi(n, e), n = Dc(2), r = ho(t, n, 2), r !== null && (Oc(n, r, t, e), ht(r, 2), Ef(r));
					break;
				}
			}
			t = t.return;
		}
	}
	function mf(e, t, n) {
		var r = e.pingCache;
		if (r === null) {
			r = e.pingCache = new Qu();
			var i = /* @__PURE__ */ new Set();
			r.set(t, i);
		} else i = r.get(t), i === void 0 && (i = /* @__PURE__ */ new Set(), r.set(t, i));
		i.has(n) || (rd = !0, i.add(n), e = hf.bind(null, e, t, n), t.then(e, e));
	}
	function hf(e, t, n) {
		var r = e.pingCache;
		r !== null && r.delete(t), e.pingedLanes |= e.suspendedLanes & n, e.warmLanes &= ~n, $u === e && (Y & n) === n && (ad === 4 || ad === 3 && (Y & 62914560) === Y && 300 > We() - md ? q & 2 ? cd |= n : Vd(e, 0) : cd |= n, ud === Y && (ud = 0)), Ef(e);
	}
	function gf(e, t) {
		t === 0 && (t = pt()), e = wi(e, t), e !== null && (ht(e, t), Ef(e));
	}
	function _f(e) {
		var t = e.memoizedState, n = 0;
		t !== null && (n = t.retryLane), gf(e, n);
	}
	function vf(e, t) {
		var n = 0;
		switch (e.tag) {
			case 31:
			case 13:
				var r = e.stateNode, i = e.memoizedState;
				i !== null && (n = i.retryLane);
				break;
			case 19:
				r = e.stateNode;
				break;
			case 22:
				r = e.stateNode._retryCache;
				break;
			default: throw Error(s(314));
		}
		r !== null && r.delete(t), gf(e, n);
	}
	function yf(e, t) {
		return Be(e, t);
	}
	var bf = null, xf = null, Sf = !1, Cf = !1, wf = !1, Tf = 0;
	function Ef(e) {
		e !== xf && e.next === null && (xf === null ? bf = xf = e : xf = xf.next = e), Cf = !0, Sf || (Sf = !0, Nf());
	}
	function Df(e, t) {
		if (!wf && Cf) {
			wf = !0;
			do
				for (var n = !1, r = bf; r !== null;) {
					if (!t) {
						if (e !== 0) {
							var i = r.pendingLanes;
							if (i === 0) var a = 0;
							else {
								var o = r.suspendedLanes, s = r.pingedLanes;
								a = (1 << 31 - tt(42 | e) + 1) - 1, a &= i & ~(o & ~s), a = a & 201326741 ? a & 201326741 | 1 : a ? a | 2 : 0;
							}
							a !== 0 && (n = !0, Mf(r, a));
						} else a = Y, a = lt(r, r === $u ? a : 0, r.cancelPendingCommit !== null || r.timeoutHandle !== -1), !(a & 3) || ut(r, a) || (n = !0, Mf(r, a));
					}
					r = r.next;
				}
			while (n);
			wf = !1;
		}
	}
	function Of() {
		kf();
	}
	function kf() {
		Cf = Sf = !1;
		var e = 0;
		Tf !== 0 && hp() && (e = Tf);
		for (var t = We(), n = null, r = bf; r !== null;) {
			var i = r.next, a = Af(r, t);
			a === 0 ? (r.next = null, n === null ? bf = i : n.next = i, i === null && (xf = n)) : (n = r, (e !== 0 || a & 3) && (Cf = !0)), r = i;
		}
		yd !== 0 && yd !== 5 || Df(e, !1), Tf !== 0 && (Tf = 0);
	}
	function Af(e, t) {
		for (var n = e.suspendedLanes, r = e.pingedLanes, i = e.expirationTimes, a = e.pendingLanes & -62914561; 0 < a;) {
			var o = 31 - tt(a), s = 1 << o, c = i[o];
			c === -1 ? ((s & n) === 0 || (s & r) !== 0) && (i[o] = ft(s, t)) : c <= t && (e.expiredLanes |= s), a &= ~s;
		}
		if (t = $u, n = Y, n = lt(e, e === t ? n : 0, e.cancelPendingCommit !== null || e.timeoutHandle !== -1), r = e.callbackNode, n === 0 || e === t && (X === 2 || X === 9) || e.cancelPendingCommit !== null) return r !== null && r !== null && Ve(r), e.callbackNode = null, e.callbackPriority = 0;
		if (!(n & 3) || ut(e, n)) {
			if (t = n & -n, t === e.callbackPriority) return t;
			switch (r !== null && Ve(r), yt(n)) {
				case 2:
				case 8:
					n = qe;
					break;
				case 32:
					n = Je;
					break;
				case 268435456:
					n = Xe;
					break;
				default: n = Je;
			}
			return r = jf.bind(null, e), n = Be(n, r), e.callbackPriority = t, e.callbackNode = n, t;
		}
		return r !== null && r !== null && Ve(r), e.callbackPriority = 2, e.callbackNode = null, 2;
	}
	function jf(e, t) {
		if (yd !== 0 && yd !== 5) return e.callbackNode = null, e.callbackPriority = 0, null;
		var n = e.callbackNode;
		if (df() && e.callbackNode !== n) return null;
		var r = Y;
		return r = lt(e, e === $u ? r : 0, e.cancelPendingCommit !== null || e.timeoutHandle !== -1), r === 0 ? null : (Fd(e, r, t), Af(e, We()), e.callbackNode != null && e.callbackNode === n ? jf.bind(null, e) : null);
	}
	function Mf(e, t) {
		if (df()) return null;
		Fd(e, t, !0);
	}
	function Nf() {
		bp(function() {
			q & 6 ? Be(Ke, Of) : kf();
		});
	}
	function Pf() {
		if (Tf === 0) {
			var e = Ia;
			e === 0 && (e = at, at <<= 1, !(at & 261888) && (at = 256)), Tf = e;
		}
		return Tf;
	}
	function Ff(e) {
		return e == null || typeof e == "symbol" || typeof e == "boolean" ? null : typeof e == "function" ? e : hn(e);
	}
	function If(e, t, n, r, i) {
		if (t === "submit" && n && n.stateNode === i) {
			var a = Ff((i[z] || null).action), o = r.submitter;
			o && (t = (t = o[z] || null) ? Ff(t.formAction) : o.getAttribute("formAction"), t !== null && (a = t, o = null));
			var s = new Ln("action", "action", null, r, i);
			e.push({
				event: s,
				listeners: [{
					instance: null,
					listener: function() {
						if (r.defaultPrevented) {
							if (Tf !== 0) {
								var e = new FormData(i, o);
								Qs(n, {
									pending: !0,
									data: e,
									method: i.method,
									action: a
								}, null, e);
							}
						} else typeof a == "function" && (s.preventDefault(), e = new FormData(i, o), Qs(n, {
							pending: !0,
							data: e,
							method: i.method,
							action: a
						}, a, e));
					},
					currentTarget: i
				}]
			});
		}
	}
	for (var Lf = 0; Lf < di.length; Lf++) {
		var Rf = di[Lf];
		fi(Rf.toLowerCase(), "on" + (Rf[0].toUpperCase() + Rf.slice(1)));
	}
	fi(ri, "onAnimationEnd"), fi(ii, "onAnimationIteration"), fi(ai, "onAnimationStart"), fi("dblclick", "onDoubleClick"), fi("focusin", "onFocus"), fi("focusout", "onBlur"), fi(oi, "onTransitionRun"), fi(si, "onTransitionStart"), fi(ci, "onTransitionCancel"), fi(li, "onTransitionEnd"), Bt("onMouseEnter", ["mouseout", "mouseover"]), Bt("onMouseLeave", ["mouseout", "mouseover"]), Bt("onPointerEnter", ["pointerout", "pointerover"]), Bt("onPointerLeave", ["pointerout", "pointerover"]), zt("onChange", "change click focusin focusout input keydown keyup selectionchange".split(" ")), zt("onSelect", "focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" ")), zt("onBeforeInput", [
		"compositionend",
		"keypress",
		"textInput",
		"paste"
	]), zt("onCompositionEnd", "compositionend focusout keydown keypress keyup mousedown".split(" ")), zt("onCompositionStart", "compositionstart focusout keydown keypress keyup mousedown".split(" ")), zt("onCompositionUpdate", "compositionupdate focusout keydown keypress keyup mousedown".split(" "));
	var zf = "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "), Bf = new Set("beforetoggle cancel close invalid load scroll scrollend toggle".split(" ").concat(zf));
	function Vf(e, t) {
		t = !!(t & 4);
		for (var n = 0; n < e.length; n++) {
			var r = e[n], i = r.event;
			r = r.listeners;
			a: {
				var a = void 0;
				if (t) for (var o = r.length - 1; 0 <= o; o--) {
					var s = r[o], c = s.instance, l = s.currentTarget;
					if (s = s.listener, c !== a && i.isPropagationStopped()) break a;
					a = s, i.currentTarget = l;
					try {
						a(i);
					} catch (e) {
						_i(e);
					}
					i.currentTarget = null, a = c;
				}
				else for (o = 0; o < r.length; o++) {
					if (s = r[o], c = s.instance, l = s.currentTarget, s = s.listener, c !== a && i.isPropagationStopped()) break a;
					a = s, i.currentTarget = l;
					try {
						a(i);
					} catch (e) {
						_i(e);
					}
					i.currentTarget = null, a = c;
				}
			}
		}
	}
	function Q(e, t) {
		var n = t[wt];
		n === void 0 && (n = t[wt] = /* @__PURE__ */ new Set());
		var r = e + "__bubble";
		n.has(r) || (Gf(t, e, 2, !1), n.add(r));
	}
	function Hf(e, t, n) {
		var r = 0;
		t && (r |= 4), Gf(n, e, r, t);
	}
	var Uf = "_reactListening" + Math.random().toString(36).slice(2);
	function Wf(e) {
		if (!e[Uf]) {
			e[Uf] = !0, Lt.forEach(function(t) {
				t !== "selectionchange" && (Bf.has(t) || Hf(t, !1, e), Hf(t, !0, e));
			});
			var t = e.nodeType === 9 ? e : e.ownerDocument;
			t === null || t[Uf] || (t[Uf] = !0, Hf("selectionchange", !1, t));
		}
	}
	function Gf(e, t, n, r) {
		switch (Ch(t)) {
			case 2:
				var i = _h;
				break;
			case 8:
				i = vh;
				break;
			default: i = yh;
		}
		n = i.bind(null, t, n, e), i = void 0, !En || t !== "touchstart" && t !== "touchmove" && t !== "wheel" || (i = !0), r ? i === void 0 ? e.addEventListener(t, n, !0) : e.addEventListener(t, n, {
			capture: !0,
			passive: i
		}) : i === void 0 ? e.addEventListener(t, n, !1) : e.addEventListener(t, n, { passive: i });
	}
	function Kf(e, t, n, r, i) {
		var a = r;
		if (!(t & 1) && !(t & 2) && r !== null) a: for (;;) {
			if (r === null) return;
			var o = r.tag;
			if (o === 3 || o === 4) {
				var s = r.stateNode.containerInfo;
				if (s === i) break;
				if (o === 4) for (o = r.return; o !== null;) {
					var c = o.tag;
					if ((c === 3 || c === 4) && o.stateNode.containerInfo === i) return;
					o = o.return;
				}
				for (; s !== null;) {
					if (o = jt(s), o === null) return;
					if (c = o.tag, c === 5 || c === 6 || c === 26 || c === 27) {
						r = a = o;
						continue a;
					}
					s = s.parentNode;
				}
			}
			r = r.return;
		}
		Cn(function() {
			var r = a, i = vn(n), o = [];
			a: {
				var s = ui.get(e);
				if (s !== void 0) {
					var c = Ln, u = e;
					switch (e) {
						case "keypress": if (Mn(n) === 0) break a;
						case "keydown":
						case "keyup":
							c = tr;
							break;
						case "focusin":
							u = "focus", c = Kn;
							break;
						case "focusout":
							u = "blur", c = Kn;
							break;
						case "beforeblur":
						case "afterblur":
							c = Kn;
							break;
						case "click": if (n.button === 2) break a;
						case "auxclick":
						case "dblclick":
						case "mousedown":
						case "mousemove":
						case "mouseup":
						case "mouseout":
						case "mouseover":
						case "contextmenu":
							c = Wn;
							break;
						case "drag":
						case "dragend":
						case "dragenter":
						case "dragexit":
						case "dragleave":
						case "dragover":
						case "dragstart":
						case "drop":
							c = Gn;
							break;
						case "touchcancel":
						case "touchend":
						case "touchmove":
						case "touchstart":
							c = ir;
							break;
						case ri:
						case ii:
						case ai:
							c = qn;
							break;
						case li:
							c = ar;
							break;
						case "scroll":
						case "scrollend":
							c = zn;
							break;
						case "wheel":
							c = or;
							break;
						case "copy":
						case "cut":
						case "paste":
							c = Jn;
							break;
						case "gotpointercapture":
						case "lostpointercapture":
						case "pointercancel":
						case "pointerdown":
						case "pointermove":
						case "pointerout":
						case "pointerover":
						case "pointerup":
							c = nr;
							break;
						case "submit":
							c = rr;
							break;
						case "toggle":
						case "beforetoggle": c = sr;
					}
					var d = !!(t & 4), f = !d && (e === "scroll" || e === "scrollend"), p = d ? s === null ? null : s + "Capture" : s;
					d = [];
					for (var m = r, h; m !== null;) {
						var g = m;
						if (h = g.stateNode, g = g.tag, g !== 5 && g !== 26 && g !== 27 || h === null || p === null || (g = wn(m, p), g != null && d.push(qf(m, g, h))), f) break;
						m = m.return;
					}
					0 < d.length && (s = new c(s, u, null, n, i), o.push({
						event: s,
						listeners: d
					}));
				}
			}
			if (!(t & 7)) {
				a: {
					if (c = e === "mouseover" || e === "pointerover", s = e === "mouseout" || e === "pointerout", c && n !== _n && (u = n.relatedTarget || n.fromElement) && (jt(u) || u[Ct])) break a;
					(s || c) && (u = i.window === i ? i : (c = i.ownerDocument) ? c.defaultView || c.parentWindow : window, s ? (c = n.relatedTarget || n.toElement, s = r, c = c ? jt(c) : null, c !== null && (f = l(c), d = c.tag, c !== f || d !== 5 && d !== 27 && d !== 6) && (c = null)) : (s = null, c = r), s !== c && (d = Wn, g = "onMouseLeave", p = "onMouseEnter", m = "mouse", (e === "pointerout" || e === "pointerover") && (d = nr, g = "onPointerLeave", p = "onPointerEnter", m = "pointer"), f = s == null ? u : Nt(s), h = c == null ? u : Nt(c), u = new d(g, m + "leave", s, n, i), u.target = f, u.relatedTarget = h, g = null, jt(i) === r && (d = new d(p, m + "enter", c, n, i), d.target = h, d.relatedTarget = f, g = d), f = g, d = s && c ? te(s, c, Yf) : null, s !== null && Xf(o, u, s, d, !1), c !== null && f !== null && Xf(o, f, c, d, !0)));
				}
				a: {
					if (s = r ? Nt(r) : window, c = s.nodeName && s.nodeName.toLowerCase(), c === "select" || c === "input" && s.type === "file") var _ = Er;
					else if (H(s)) {
						if (Dr) _ = Ir;
						else {
							_ = Pr;
							var v = Nr;
						}
					} else c = s.nodeName, !c || c.toLowerCase() !== "input" || s.type !== "checkbox" && s.type !== "radio" ? r && fn(r.elementType) && (_ = Er) : _ = Fr;
					if (_ &&= _(e, r)) {
						xr(o, _, n, i);
						break a;
					}
					v && v(e, s, r);
				}
				switch (v = r ? Nt(r) : window, e) {
					case "focusin":
						(H(v) || v.contentEditable === "true") && (qr = v, Jr = r, Yr = null);
						break;
					case "focusout":
						Yr = Jr = qr = null;
						break;
					case "mousedown":
						Xr = !0;
						break;
					case "contextmenu":
					case "mouseup":
					case "dragend":
						Xr = !1, Zr(o, n, i);
						break;
					case "selectionchange": if (Kr) break;
					case "keydown":
					case "keyup": Zr(o, n, i);
				}
				var y;
				if (lr) b: {
					switch (e) {
						case "compositionstart":
							var b = "onCompositionStart";
							break b;
						case "compositionend":
							b = "onCompositionEnd";
							break b;
						case "compositionupdate":
							b = "onCompositionUpdate";
							break b;
					}
					b = void 0;
				}
				else _r ? hr(e, n) && (b = "onCompositionEnd") : e === "keydown" && n.keyCode === 229 && (b = "onCompositionStart");
				b && (fr && n.locale !== "ko" && (_r || b !== "onCompositionStart" ? b === "onCompositionEnd" && _r && (y = jn()) : (On = i, kn = "value" in On ? On.value : On.textContent, _r = !0)), v = Jf(r, b), 0 < v.length && (b = new Yn(b, e, null, n, i), o.push({
					event: b,
					listeners: v
				}), y ? b.data = y : (y = gr(n), y !== null && (b.data = y)))), (y = dr ? vr(e, n) : yr(e, n)) && (b = Jf(r, "onBeforeInput"), 0 < b.length && (v = new Yn("onBeforeInput", "beforeinput", null, n, i), o.push({
					event: v,
					listeners: b
				}), v.data = y)), If(o, e, r, n, i);
			}
			Vf(o, t);
		});
	}
	function qf(e, t, n) {
		return {
			instance: e,
			listener: t,
			currentTarget: n
		};
	}
	function Jf(e, t) {
		for (var n = t + "Capture", r = []; e !== null;) {
			var i = e, a = i.stateNode;
			if (i = i.tag, i !== 5 && i !== 26 && i !== 27 || a === null || (i = wn(e, n), i != null && r.unshift(qf(e, i, a)), i = wn(e, t), i != null && r.push(qf(e, i, a))), e.tag === 3) return r;
			e = e.return;
		}
		return [];
	}
	function Yf(e) {
		if (e === null) return null;
		do
			e = e.return;
		while (e && e.tag !== 5 && e.tag !== 27);
		return e || null;
	}
	function Xf(e, t, n, r, i) {
		for (var a = t._reactName, o = []; n !== null && n !== r;) {
			var s = n, c = s.alternate, l = s.stateNode;
			if (s = s.tag, c !== null && c === r) break;
			s !== 5 && s !== 26 && s !== 27 || l === null || (c = l, i ? (l = wn(n, a), l != null && o.unshift(qf(n, l, c))) : i || (l = wn(n, a), l != null && o.push(qf(n, l, c)))), n = n.return;
		}
		o.length !== 0 && e.push({
			event: t,
			listeners: o
		});
	}
	var Zf = /\r\n?/g, Qf = /\u0000|\uFFFD/g;
	function $f(e) {
		return (typeof e == "string" ? e : "" + e).replace(Zf, "\n").replace(Qf, "");
	}
	function ep(e, t) {
		return t = $f(t), $f(e) === t;
	}
	function $(e, t, n, r, i, a) {
		switch (n) {
			case "children":
				if (typeof r == "string") t === "body" || t === "textarea" && r === "" || cn(e, r);
				else if (typeof r == "number" || typeof r == "bigint") t !== "body" && cn(e, "" + r);
				else return;
				break;
			case "className":
				qt(e, "class", r);
				break;
			case "tabIndex":
				qt(e, "tabindex", r);
				break;
			case "dir":
			case "role":
			case "viewBox":
			case "width":
			case "height":
				qt(e, n, r);
				break;
			case "style":
				dn(e, r, a);
				return;
			case "data": if (t !== "object") {
				qt(e, "data", r);
				break;
			}
			case "src":
			case "href":
				if (r === "" && (t !== "a" || n !== "href") || r == null || typeof r == "function" || typeof r == "symbol" || typeof r == "boolean") {
					e.removeAttribute(n);
					break;
				}
				r = hn(r), e.setAttribute(n, r);
				break;
			case "action":
			case "formAction":
				if (typeof r == "function") {
					e.setAttribute(n, "javascript:throw new Error('A React form was unexpectedly submitted. If you called form.submit() manually, consider using form.requestSubmit() instead. If you\\'re trying to use event.stopPropagation() in a submit event handler, consider also calling event.preventDefault().')");
					break;
				}
				if (typeof a == "function" && (n === "formAction" ? (t !== "input" && $(e, t, "name", i.name, i, null), $(e, t, "formEncType", i.formEncType, i, null), $(e, t, "formMethod", i.formMethod, i, null), $(e, t, "formTarget", i.formTarget, i, null)) : ($(e, t, "encType", i.encType, i, null), $(e, t, "method", i.method, i, null), $(e, t, "target", i.target, i, null))), r == null || typeof r == "symbol" || typeof r == "boolean") {
					e.removeAttribute(n);
					break;
				}
				r = hn(r), e.setAttribute(n, r);
				break;
			case "onClick":
				r != null && (e.onclick = gn);
				return;
			case "onScroll":
				r != null && Q("scroll", e);
				return;
			case "onScrollEnd":
				r != null && Q("scrollend", e);
				return;
			case "dangerouslySetInnerHTML":
				if (r != null) {
					if (typeof r != "object" || !("__html" in r)) throw Error(s(61));
					if (n = r.__html, n != null) {
						if (i.children != null) throw Error(s(60));
						a?.__html !== n && (e.innerHTML = n);
					}
				}
				break;
			case "multiple":
				e.multiple = r && typeof r != "function" && typeof r != "symbol";
				break;
			case "muted":
				e.muted = r && typeof r != "function" && typeof r != "symbol";
				break;
			case "suppressContentEditableWarning":
			case "suppressHydrationWarning":
			case "defaultValue":
			case "defaultChecked":
			case "innerHTML":
			case "ref": break;
			case "autoFocus": break;
			case "xlinkHref":
				if (r == null || typeof r == "function" || typeof r == "boolean" || typeof r == "symbol") {
					e.removeAttribute("xlink:href");
					break;
				}
				n = hn(r), e.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", n);
				break;
			case "contentEditable":
			case "spellCheck":
			case "draggable":
			case "value":
			case "autoReverse":
			case "externalResourcesRequired":
			case "focusable":
			case "preserveAlpha":
				r != null && typeof r != "function" && typeof r != "symbol" ? e.setAttribute(n, r) : e.removeAttribute(n);
				break;
			case "inert":
			case "allowFullScreen":
			case "async":
			case "autoPlay":
			case "controls":
			case "credentialless":
			case "default":
			case "defer":
			case "disabled":
			case "disablePictureInPicture":
			case "disableRemotePlayback":
			case "formNoValidate":
			case "hidden":
			case "loop":
			case "noModule":
			case "noValidate":
			case "open":
			case "playsInline":
			case "readOnly":
			case "required":
			case "reversed":
			case "scoped":
			case "seamless":
			case "itemScope":
				r && typeof r != "function" && typeof r != "symbol" ? e.setAttribute(n, "") : e.removeAttribute(n);
				break;
			case "capture":
			case "download":
				!0 === r ? e.setAttribute(n, "") : !1 !== r && r != null && typeof r != "function" && typeof r != "symbol" ? e.setAttribute(n, r) : e.removeAttribute(n);
				break;
			case "cols":
			case "rows":
			case "size":
			case "span":
				r != null && typeof r != "function" && typeof r != "symbol" && !isNaN(r) && 1 <= r ? e.setAttribute(n, r) : e.removeAttribute(n);
				break;
			case "rowSpan":
			case "start":
				r == null || typeof r == "function" || typeof r == "symbol" || isNaN(r) ? e.removeAttribute(n) : e.setAttribute(n, r);
				break;
			case "popover":
				Q("beforetoggle", e), Q("toggle", e), Kt(e, "popover", r);
				break;
			case "xlinkActuate":
				Jt(e, "http://www.w3.org/1999/xlink", "xlink:actuate", r);
				break;
			case "xlinkArcrole":
				Jt(e, "http://www.w3.org/1999/xlink", "xlink:arcrole", r);
				break;
			case "xlinkRole":
				Jt(e, "http://www.w3.org/1999/xlink", "xlink:role", r);
				break;
			case "xlinkShow":
				Jt(e, "http://www.w3.org/1999/xlink", "xlink:show", r);
				break;
			case "xlinkTitle":
				Jt(e, "http://www.w3.org/1999/xlink", "xlink:title", r);
				break;
			case "xlinkType":
				Jt(e, "http://www.w3.org/1999/xlink", "xlink:type", r);
				break;
			case "xmlBase":
				Jt(e, "http://www.w3.org/XML/1998/namespace", "xml:base", r);
				break;
			case "xmlLang":
				Jt(e, "http://www.w3.org/XML/1998/namespace", "xml:lang", r);
				break;
			case "xmlSpace":
				Jt(e, "http://www.w3.org/XML/1998/namespace", "xml:space", r);
				break;
			case "is":
				Kt(e, "is", r);
				break;
			case "innerText":
			case "textContent": return;
			default: if (!(2 < n.length) || n[0] !== "o" && n[0] !== "O" || n[1] !== "n" && n[1] !== "N") n = pn.get(n) || n, Kt(e, n, r);
			else return;
		}
		B = !0;
	}
	function tp(e, t, n, r, i, a) {
		switch (n) {
			case "style":
				dn(e, r, a);
				return;
			case "dangerouslySetInnerHTML":
				if (r != null) {
					if (typeof r != "object" || !("__html" in r)) throw Error(s(61));
					if (n = r.__html, n != null) {
						if (i.children != null) throw Error(s(60));
						a?.__html !== n && (e.innerHTML = n);
					}
				}
				break;
			case "children":
				if (typeof r == "string") cn(e, r);
				else if (typeof r == "number" || typeof r == "bigint") cn(e, "" + r);
				else return;
				break;
			case "onScroll":
				r != null && Q("scroll", e);
				return;
			case "onScrollEnd":
				r != null && Q("scrollend", e);
				return;
			case "onClick":
				r != null && (e.onclick = gn);
				return;
			case "suppressContentEditableWarning":
			case "suppressHydrationWarning":
			case "innerHTML":
			case "ref": return;
			case "innerText":
			case "textContent": return;
			default:
				if (!Rt.hasOwnProperty(n)) a: {
					if (n[0] === "o" && n[1] === "n" && (i = n.endsWith("Capture"), a = n.slice(2, i ? n.length - 7 : void 0), t = e[z] || null, t = t == null ? null : t[n], typeof t == "function" && e.removeEventListener(a, t, i), typeof r == "function")) {
						typeof t != "function" && t !== null && (n in e ? e[n] = null : e.hasAttribute(n) && e.removeAttribute(n)), e.addEventListener(a, r, i);
						break a;
					}
					B = !0, n in e ? e[n] = r : !0 === r ? e.setAttribute(n, "") : Kt(e, n, r);
				}
				return;
		}
		B = !0;
	}
	function np(e, t, n) {
		switch (t) {
			case "div":
			case "span":
			case "svg":
			case "path":
			case "a":
			case "g":
			case "p":
			case "li": break;
			case "img":
				Q("error", e), Q("load", e);
				var r = !1, i = !1, a;
				for (a in n) if (n.hasOwnProperty(a)) {
					var o = n[a];
					if (o != null) switch (a) {
						case "src":
							r = !0;
							break;
						case "srcSet":
							i = !0;
							break;
						case "children":
						case "dangerouslySetInnerHTML": throw Error(s(137, t));
						default: $(e, t, a, o, n, null);
					}
				}
				i && $(e, t, "srcSet", n.srcSet, n, null), r && $(e, t, "src", n.src, n, null);
				return;
			case "input":
				Q("invalid", e);
				var c = a = o = i = null, l = null, u = null;
				for (r in n) if (n.hasOwnProperty(r)) {
					var d = n[r];
					if (d != null) switch (r) {
						case "name":
							i = d;
							break;
						case "type":
							o = d;
							break;
						case "checked":
							l = d;
							break;
						case "defaultChecked":
							u = d;
							break;
						case "value":
							a = d;
							break;
						case "defaultValue":
							c = d;
							break;
						case "children":
						case "dangerouslySetInnerHTML":
							if (d != null) throw Error(s(137, t));
							break;
						default: $(e, t, r, d, n, null);
					}
				}
				nn(e, a, c, l, u, o, i, !1);
				return;
			case "select":
				for (i in Q("invalid", e), r = o = a = null, n) if (n.hasOwnProperty(i) && (c = n[i], c != null)) switch (i) {
					case "value":
						a = c;
						break;
					case "defaultValue":
						o = c;
						break;
					case "multiple": r = c;
					default: $(e, t, i, c, n, null);
				}
				t = a, n = o, e.multiple = !!r, t == null ? n != null && an(e, !!r, n, !0) : an(e, !!r, t, !1);
				return;
			case "textarea":
				for (o in Q("invalid", e), a = i = r = null, n) if (n.hasOwnProperty(o) && (c = n[o], c != null)) switch (o) {
					case "value":
						r = c;
						break;
					case "defaultValue":
						i = c;
						break;
					case "children":
						a = c;
						break;
					case "dangerouslySetInnerHTML":
						if (c != null) throw Error(s(91));
						break;
					default: $(e, t, o, c, n, null);
				}
				sn(e, r, i, a);
				return;
			case "option":
				for (l in n) if (n.hasOwnProperty(l) && (r = n[l], r != null)) switch (l) {
					case "selected":
						e.selected = r && typeof r != "function" && typeof r != "symbol";
						break;
					default: $(e, t, l, r, n, null);
				}
				return;
			case "dialog":
				Q("beforetoggle", e), Q("toggle", e), Q("cancel", e), Q("close", e);
				break;
			case "iframe":
			case "object":
				Q("load", e);
				break;
			case "video":
			case "audio":
				for (r = 0; r < zf.length; r++) Q(zf[r], e);
				break;
			case "image":
				Q("error", e), Q("load", e);
				break;
			case "details":
				Q("toggle", e);
				break;
			case "embed":
			case "source":
			case "link": Q("error", e), Q("load", e);
			case "area":
			case "base":
			case "br":
			case "col":
			case "hr":
			case "keygen":
			case "meta":
			case "param":
			case "track":
			case "wbr":
			case "menuitem":
				for (u in n) if (n.hasOwnProperty(u) && (r = n[u], r != null)) switch (u) {
					case "children":
					case "dangerouslySetInnerHTML": throw Error(s(137, t));
					default: $(e, t, u, r, n, null);
				}
				return;
			default: if (fn(t)) {
				for (d in n) n.hasOwnProperty(d) && (r = n[d], r !== void 0 && tp(e, t, d, r, n, void 0));
				return;
			}
		}
		for (c in n) n.hasOwnProperty(c) && (r = n[c], r != null && $(e, t, c, r, n, null));
	}
	var rp = {};
	function ip(e, t, n, r) {
		switch (t) {
			case "div":
			case "span":
			case "svg":
			case "path":
			case "a":
			case "g":
			case "p":
			case "li": break;
			case "input":
				var i = null, a = null, o = null, c = null, l = null, u = null, d = null;
				for (m in n) {
					var f = n[m];
					if (n.hasOwnProperty(m) && f != null) switch (m) {
						case "checked": break;
						case "value": break;
						case "defaultValue": l = f;
						default: r.hasOwnProperty(m) || $(e, t, m, null, r, f);
					}
				}
				for (var p in r) {
					var m = r[p];
					if (f = n[p], r.hasOwnProperty(p) && (m != null || f != null)) switch (p) {
						case "type":
							m !== f && (B = !0), a = m;
							break;
						case "name":
							m !== f && (B = !0), i = m;
							break;
						case "checked":
							m !== f && (B = !0), u = m;
							break;
						case "defaultChecked":
							m !== f && (B = !0), d = m;
							break;
						case "value":
							m !== f && (B = !0), o = m;
							break;
						case "defaultValue":
							m !== f && (B = !0), c = m;
							break;
						case "children":
						case "dangerouslySetInnerHTML":
							if (m != null) throw Error(s(137, t));
							break;
						default: m !== f && $(e, t, p, m, r, f);
					}
				}
				tn(e, o, c, l, u, d, a, i);
				return;
			case "select":
				for (a in m = o = c = p = null, n) if (l = n[a], n.hasOwnProperty(a) && l != null) switch (a) {
					case "value": break;
					case "multiple": m = l;
					default: r.hasOwnProperty(a) || $(e, t, a, null, r, l);
				}
				for (i in r) if (a = r[i], l = n[i], r.hasOwnProperty(i) && (a != null || l != null)) switch (i) {
					case "value":
						a !== l && (B = !0), p = a;
						break;
					case "defaultValue":
						a !== l && (B = !0), c = a;
						break;
					case "multiple": a !== l && (B = !0), o = a;
					default: a !== l && $(e, t, i, a, r, l);
				}
				t = c, n = o, r = m, p == null ? !!r != !!n && (t == null ? an(e, !!n, n ? [] : "", !1) : an(e, !!n, t, !0)) : an(e, !!n, p, !1);
				return;
			case "textarea":
				for (c in m = p = null, n) if (i = n[c], n.hasOwnProperty(c) && i != null && !r.hasOwnProperty(c)) switch (c) {
					case "value": break;
					case "children": break;
					default: $(e, t, c, null, r, i);
				}
				for (o in r) if (i = r[o], a = n[o], r.hasOwnProperty(o) && (i != null || a != null)) switch (o) {
					case "value":
						i !== a && (B = !0), p = i;
						break;
					case "defaultValue":
						i !== a && (B = !0), m = i;
						break;
					case "children": break;
					case "dangerouslySetInnerHTML":
						if (i != null) throw Error(s(91));
						break;
					default: i !== a && $(e, t, o, i, r, a);
				}
				on(e, p, m);
				return;
			case "option":
				for (var h in n) if (p = n[h], n.hasOwnProperty(h) && p != null && !r.hasOwnProperty(h)) switch (h) {
					case "selected":
						e.selected = !1;
						break;
					default: $(e, t, h, null, r, p);
				}
				for (l in r) if (p = r[l], m = n[l], r.hasOwnProperty(l) && p !== m && (p != null || m != null)) switch (l) {
					case "selected":
						p !== m && (B = !0), e.selected = p && typeof p != "function" && typeof p != "symbol";
						break;
					default: $(e, t, l, p, r, m);
				}
				return;
			case "img":
			case "link":
			case "area":
			case "base":
			case "br":
			case "col":
			case "embed":
			case "hr":
			case "keygen":
			case "meta":
			case "param":
			case "source":
			case "track":
			case "wbr":
			case "menuitem":
				for (var g in n) p = n[g], n.hasOwnProperty(g) && p != null && !r.hasOwnProperty(g) && $(e, t, g, null, r, p);
				for (u in r) if (p = r[u], m = n[u], r.hasOwnProperty(u) && p !== m && (p != null || m != null)) switch (u) {
					case "children":
					case "dangerouslySetInnerHTML":
						if (p != null) throw Error(s(137, t));
						break;
					default: $(e, t, u, p, r, m);
				}
				return;
			default: if (fn(t)) {
				for (var _ in n) p = n[_], n.hasOwnProperty(_) && p !== void 0 && !r.hasOwnProperty(_) && tp(e, t, _, void 0, r, p);
				for (d in r) p = r[d], m = n[d], !r.hasOwnProperty(d) || p === m || p === void 0 && m === void 0 || tp(e, t, d, p, r, m);
				return;
			}
		}
		for (var v in n) p = n[v], n.hasOwnProperty(v) && p != null && !r.hasOwnProperty(v) && $(e, t, v, null, r, p);
		for (f in r) p = r[f], m = n[f], !r.hasOwnProperty(f) || p === m || p == null && m == null || $(e, t, f, p, r, m);
	}
	function ap(e) {
		switch (e) {
			case "css":
			case "script":
			case "font":
			case "img":
			case "image":
			case "input":
			case "link": return !0;
			default: return !1;
		}
	}
	function op() {
		if (typeof performance.getEntriesByType == "function") {
			for (var e = 0, t = 0, n = performance.getEntriesByType("resource"), r = 0; r < n.length; r++) {
				var i = n[r], a = i.transferSize, o = i.initiatorType, s = i.duration;
				if (a && s && ap(o)) {
					for (o = 0, s = i.responseEnd, r += 1; r < n.length; r++) {
						var c = n[r], l = c.startTime;
						if (l > s) break;
						var u = c.transferSize, d = c.initiatorType;
						u && ap(d) && (c = c.responseEnd, o += u * (c < s ? 1 : (s - l) / (c - l)));
					}
					if (--r, t += 8 * (a + o) / (i.duration / 1e3), e++, 10 < e) break;
				}
			}
			if (0 < e) return t / e / 1e6;
		}
		return navigator.connection && (e = navigator.connection.downlink, typeof e == "number") ? e : 5;
	}
	var sp = null, cp = null;
	function lp(e) {
		return e.nodeType === 9 ? e : e.ownerDocument;
	}
	function up(e) {
		switch (e) {
			case "http://www.w3.org/2000/svg": return 1;
			case "http://www.w3.org/1998/Math/MathML": return 2;
			default: return 0;
		}
	}
	function dp(e, t) {
		if (e === 0) switch (t) {
			case "svg": return 1;
			case "math": return 2;
			default: return 0;
		}
		return e === 1 && t === "foreignObject" ? 0 : e;
	}
	function fp(e, t, n, r) {
		return n = lp(n).createElement(e), n[R] = r, n[z] = t, np(n, e, t), Ft(n), n;
	}
	function pp(e, t) {
		return e === "textarea" || e === "noscript" || typeof t.children == "string" || typeof t.children == "number" || typeof t.children == "bigint" || typeof t.dangerouslySetInnerHTML == "object" && t.dangerouslySetInnerHTML !== null && t.dangerouslySetInnerHTML.__html != null;
	}
	var mp = null;
	function hp() {
		var e = window.event;
		return e && e.type === "popstate" ? e !== mp && (mp = e, !0) : (mp = null, !1);
	}
	var gp = typeof setTimeout == "function" ? setTimeout : void 0, _p = typeof clearTimeout == "function" ? clearTimeout : void 0, vp = typeof Promise == "function" ? Promise : void 0, yp = typeof requestAnimationFrame == "function" ? requestAnimationFrame : gp, bp = typeof queueMicrotask == "function" ? queueMicrotask : vp === void 0 ? gp : function(e) {
		return vp.resolve(null).then(e).catch(xp);
	};
	function xp(e) {
		setTimeout(function() {
			throw e;
		});
	}
	function Sp(e) {
		return e === "head";
	}
	function Cp(e, t) {
		var n = t, r = 0;
		do {
			var i = n.nextSibling;
			if (e.removeChild(n), i && i.nodeType === 8) {
				if (n = i.data, n === "/$" || n === "/&") {
					if (r === 0) {
						e.removeChild(i), Hh(t);
						return;
					}
					r--;
				} else if (n === "$" || n === "$?" || n === "$~" || n === "$!" || n === "&") r++;
				else if (n === "html") _m(e.ownerDocument.documentElement);
				else if (n === "head") {
					n = e.ownerDocument.head, _m(n);
					for (var a = n.firstChild; a;) {
						var o = a.nextSibling, s = a.nodeName;
						a[Ot] || s === "SCRIPT" || s === "STYLE" || s === "LINK" && a.rel.toLowerCase() === "stylesheet" || n.removeChild(a), a = o;
					}
				} else n === "body" && _m(e.ownerDocument.body);
			}
			n = i;
		} while (n);
		Hh(t);
	}
	function wp(e, t) {
		var n = e;
		e = 0;
		do {
			var r = n.nextSibling;
			if (n.nodeType === 1 ? t ? (n._stashedDisplay = n.style.display, n.style.display = "none") : (n.style.display = n._stashedDisplay || "", n.getAttribute("style") === "" && n.removeAttribute("style")) : n.nodeType === 3 && (t ? (n._stashedText = n.nodeValue, n.nodeValue = "") : n.nodeValue = n._stashedText || ""), r && r.nodeType === 8) {
				if (n = r.data, n === "/$") {
					if (e === 0) break;
					e--;
				} else n !== "$" && n !== "$?" && n !== "$~" && n !== "$!" || e++;
			}
			n = r;
		} while (n);
	}
	function Tp(e, t, n) {
		if (t = CSS.escape(t) === t ? t : "r-" + btoa(t).replace(/=/g, ""), e.style.viewTransitionName = t, n != null && (e.style.viewTransitionClass = n), n = getComputedStyle(e), n.display === "inline") {
			if (t = e.getClientRects(), t.length === 1) var r = 1;
			else for (var i = r = 0; i < t.length; i++) {
				var a = t[i];
				0 < a.width && 0 < a.height && r++;
			}
			r === 1 && (e = e.style, e.display = t.length === 1 ? "inline-block" : "block", e.marginTop = "-" + n.paddingTop, e.marginBottom = "-" + n.paddingBottom);
		}
	}
	function Ep(e, t) {
		e = e.style, t = t.style;
		var n = t == null ? null : t.hasOwnProperty("viewTransitionName") ? t.viewTransitionName : t.hasOwnProperty("view-transition-name") ? t["view-transition-name"] : null;
		e.viewTransitionName = n == null || typeof n == "boolean" ? "" : ("" + n).trim(), n = t == null ? null : t.hasOwnProperty("viewTransitionClass") ? t.viewTransitionClass : t.hasOwnProperty("view-transition-class") ? t["view-transition-class"] : null, e.viewTransitionClass = n == null || typeof n == "boolean" ? "" : ("" + n).trim(), e.display === "inline-block" && (t == null ? e.display = e.margin = "" : (n = t.display, e.display = n == null || typeof n == "boolean" ? "" : n, n = t.margin, n == null ? (n = t.hasOwnProperty("marginTop") ? t.marginTop : t["margin-top"], e.marginTop = n == null || typeof n == "boolean" ? "" : n, t = t.hasOwnProperty("marginBottom") ? t.marginBottom : t["margin-bottom"], e.marginBottom = t == null || typeof t == "boolean" ? "" : t) : e.margin = n));
	}
	function Dp(e, t, n) {
		return n = n.ownerDocument.defaultView, {
			rect: e,
			abs: t.position === "absolute" || t.position === "fixed",
			clip: t.clipPath !== "none" || t.overflow !== "visible" || t.filter !== "none" || t.mask !== "none" || t.mask !== "none" || t.borderRadius !== "0px",
			view: 0 <= e.bottom && 0 <= e.right && e.top <= n.innerHeight && e.left <= n.innerWidth
		};
	}
	function Op(e) {
		return Dp(e.getBoundingClientRect(), getComputedStyle(e), e);
	}
	function kp(e) {
		var t = e.getBoundingClientRect();
		t = new DOMRect(t.x + 2e4, t.y + 2e4, t.width, t.height);
		var n = getComputedStyle(e);
		return Dp(t, n, e);
	}
	function Ap(e) {
		return e.documentElement.clientHeight;
	}
	function jp(e) {
		this.addEventListener("load", e), this.addEventListener("error", e);
	}
	function Mp(e, t, n, r, i, a, o, s, c) {
		var l = t.nodeType === 9 ? t : t.ownerDocument;
		try {
			var u = l.startViewTransition({
				update: function() {
					var t = l.defaultView, n = t.navigation && t.navigation.transition, o = l.fonts.status;
					r();
					var s = [];
					if (o === "loaded" && (Ap(l), l.fonts.status === "loading" && s.push(l.fonts.ready)), o = s.length, e !== null) for (var c = e.suspenseyImages, u = 0, d = 0; d < c.length; d++) {
						var f = c[d];
						if (!f.complete) {
							var p = f.getBoundingClientRect();
							if (0 < p.bottom && 0 < p.right && p.top < t.innerHeight && p.left < t.innerWidth) {
								if (u += Xm(f), u > $m) {
									s.length = o;
									break;
								}
								f = new Promise(jp.bind(f)), s.push(f);
							}
						}
					}
					if (0 < s.length) return t = Promise.race([Promise.all(s), new Promise(function(e) {
						return setTimeout(e, 500);
					})]).then(i, i), (n ? Promise.allSettled([n.finished, t]) : t).then(a, a);
					if (i(), n) return n.finished.then(a, a);
					a();
				},
				types: n
			});
			l.__reactViewTransition = u;
			var d = [];
			return u.ready.then(function() {
				for (var e = l.documentElement.getAnimations({ subtree: !0 }), t = 0; t < e.length; t++) {
					var n = e[t], r = n.effect, i = r.pseudoElement;
					if (i != null && i.startsWith("::view-transition")) {
						d.push(n), n = r.getKeyframes();
						for (var a = i = void 0, s = !0, c = 0; c < n.length; c++) {
							var u = n[c], f = u.width;
							if (i === void 0) i = f;
							else if (i !== f) {
								s = !1;
								break;
							}
							if (f = u.height, a === void 0) a = f;
							else if (a !== f) {
								s = !1;
								break;
							}
							delete u.width, delete u.height, u.transform === "none" && delete u.transform;
						}
						s && i !== void 0 && a !== void 0 && (r.setKeyframes(n), s = getComputedStyle(r.target, r.pseudoElement), s.width !== i || s.height !== a) && (s = n[0], s.width = i, s.height = a, s = n[n.length - 1], s.width = i, s.height = a, r.setKeyframes(n));
					}
				}
				o();
			}, function(e) {
				l.__reactViewTransition === u && (l.__reactViewTransition = null);
				try {
					if (typeof e == "object" && e) switch (e.name) {
						case "InvalidStateError": (e.message === "View transition was skipped because document visibility state is hidden." || e.message === "Skipping view transition because document visibility state has become hidden." || e.message === "Skipping view transition because viewport size changed." || e.message === "Transition was aborted because of invalid state") && (e = null);
					}
					e !== null && c(e);
				} finally {
					r(), i(), o();
				}
			}), u.finished.finally(function() {
				for (var e = 0; e < d.length; e++) d[e].cancel();
				l.__reactViewTransition === u && (l.__reactViewTransition = null), s();
			}), u;
		} catch {
			return r(), i(), o(), null;
		}
	}
	function Np(e, t) {
		this._scope = document.documentElement, this._selector = "::view-transition-" + e + "(" + t + ")";
	}
	Np.prototype.animate = function(e, t) {
		return t = typeof t == "number" ? { duration: t } : T({}, t), t.pseudoElement = this._selector, this._scope.animate(e, t);
	}, Np.prototype.getAnimations = function() {
		for (var e = this._scope, t = this._selector, n = e.getAnimations({ subtree: !0 }), r = [], i = 0; i < n.length; i++) {
			var a = n[i].effect;
			a !== null && a.target === e && a.pseudoElement === t && r.push(n[i]);
		}
		return r;
	}, Np.prototype.getComputedStyle = function() {
		return getComputedStyle(this._scope, this._selector);
	};
	function Pp(e) {
		return {
			name: e,
			group: new Np("group", e),
			imagePair: new Np("image-pair", e),
			old: new Np("old", e),
			new: new Np("new", e)
		};
	}
	function Fp(e) {
		this._fragmentFiber = e, this._observers = this._eventListeners = null;
	}
	Fp.prototype.addEventListener = function(e, t, n) {
		var r = null, i = null;
		if (!(n != null && typeof n != "boolean" && (r = n.signal || null, r !== null && r.aborted))) {
			this._eventListeners === null && (this._eventListeners = []);
			var a = this._eventListeners;
			if (Bp(a, e, t, n) === -1) {
				var o = this, s = t;
				n != null && typeof n != "boolean" && !0 === n.once && (s = function(r) {
					o.removeEventListener(e, t, n), typeof t == "function" ? t.call(this, r) : t.handleEvent(r);
				}), r !== null && (i = o.removeEventListener.bind(o, e, t, n), r.addEventListener("abort", i, { once: !0 }), i = r.removeEventListener.bind(r, "abort", i)), r = Rp(n), a.push({
					type: e,
					listener: t,
					optionsOrUseCapture: n,
					attachedListener: s,
					cleanup: i
				}), h(this._fragmentFiber.child, !1, Ip, e, s, r);
			}
			this._eventListeners = a;
		}
	};
	function Ip(e, t, n, r) {
		return b(e).addEventListener(t, n, r), !1;
	}
	Fp.prototype.removeEventListener = function(e, t, n) {
		var r = this._eventListeners;
		if (r !== null && (t = Bp(r, e, t, n), t !== -1)) {
			var i = r[t];
			n = i.attachedListener;
			var a = i.cleanup;
			i = Rp(i.optionsOrUseCapture), h(this._fragmentFiber.child, !1, Lp, e, n, i), r.splice(t, 1), a !== null && a();
		}
	};
	function Lp(e, t, n, r) {
		return b(e).removeEventListener(t, n, r), !1;
	}
	function Rp(e) {
		return e != null && typeof e != "boolean" && (!0 === e.once || e.signal instanceof AbortSignal) ? {
			capture: e.capture,
			passive: e.passive
		} : e;
	}
	function zp(e) {
		return e == null ? "c=0" : typeof e == "boolean" ? "c=" + (e ? "1" : "0") : "c=" + (e.capture ? "1" : "0");
	}
	function Bp(e, t, n, r) {
		if (e.length === 0) return -1;
		r = zp(r);
		for (var i = 0; i < e.length; i++) {
			var a = e[i];
			if (a.type === t && a.listener === n && zp(a.optionsOrUseCapture) === r) return i;
		}
		return -1;
	}
	Fp.prototype.dispatchEvent = function(e) {
		var t = g(this._fragmentFiber);
		if (t === null) return !0;
		t = b(t);
		var n = this._eventListeners;
		if (n !== null && 0 < n.length || !e.bubbles) {
			var r = t.nodeType === 9 ? t.createComment("") : document.createTextNode("");
			if (n) for (var i = 0; i < n.length; i++) {
				var a = n[i];
				r.addEventListener(a.type, a.attachedListener, Rp(a.optionsOrUseCapture));
			}
			if (t.appendChild(r), e = r.dispatchEvent(e), n) for (i = 0; i < n.length; i++) a = n[i], r.removeEventListener(a.type, a.attachedListener, Rp(a.optionsOrUseCapture));
			return t.removeChild(r), e;
		}
		return t.dispatchEvent(e);
	}, Fp.prototype.focus = function(e) {
		h(this._fragmentFiber.child, !0, Vp, e, void 0, void 0);
	};
	function Vp(e, t) {
		return e.tag !== 6 && (e = b(e), pm(e, t));
	}
	Fp.prototype.focusLast = function(e) {
		var t = [];
		h(this._fragmentFiber.child, !0, Hp, t, void 0, void 0);
		for (var n = t.length - 1; 0 <= n && !Vp(t[n], e); n--);
	};
	function Hp(e, t) {
		return t.push(e), !1;
	}
	Fp.prototype.blur = function() {
		var e = g(this._fragmentFiber);
		e !== null && (e = b(e), e = lp(e).activeElement, e !== null && h(this._fragmentFiber.child, !1, Up, e, void 0, void 0));
	};
	function Up(e, t) {
		return e.tag !== 6 && (e = b(e), e === t || e.contains(t) ? (t.blur(), !0) : !1);
	}
	Fp.prototype.observeUsing = function(e) {
		this._observers === null && (this._observers = /* @__PURE__ */ new Set()), this._observers.add(e), h(this._fragmentFiber.child, !1, Wp, e, void 0, void 0);
	};
	function Wp(e, t) {
		return e.tag === 6 || (e = b(e), t.observe(e)), !1;
	}
	Fp.prototype.unobserveUsing = function(e) {
		var t = this._observers;
		if (t !== null && t.has(e)) {
			t.delete(e), h(this._fragmentFiber.child, !1, Gp, e, void 0, void 0);
			for (var n = t = 0; n < Kp.length; n++) {
				var r = Kp[n];
				r.fragmentInstance === this && r.observer === e ? e.unobserve(r.instance) : Kp[t++] = r;
			}
			Kp.length = t;
		}
	};
	function Gp(e, t) {
		return e.tag === 6 || (e = b(e), t.unobserve(e)), !1;
	}
	var Kp = [], qp = !1;
	function Jp(e, t, n) {
		Kp.push({
			fragmentInstance: e,
			observer: t,
			instance: n
		}), qp || (qp = !0, mm(function() {
			qp = !1;
			var e = Kp;
			Kp = [];
			for (var t = 0; t < e.length; t++) {
				var n = e[t];
				n.observer.unobserve(n.instance);
			}
		}));
	}
	Fp.prototype.getClientRects = function() {
		var e = [];
		return h(this._fragmentFiber.child, !1, Yp, e, void 0, void 0), e;
	};
	function Yp(e, t) {
		if (e.tag === 6) {
			e = e.stateNode;
			var n = e.ownerDocument.createRange();
			n.selectNodeContents(e), t.push.apply(t, n.getClientRects());
		} else e = b(e), t.push.apply(t, e.getClientRects());
		return !1;
	}
	Fp.prototype.getRootNode = function(e) {
		var t = g(this._fragmentFiber);
		return t === null ? this : b(t).getRootNode(e);
	}, Fp.prototype.compareDocumentPosition = function(e) {
		var t = g(this._fragmentFiber);
		if (t === null) return Node.DOCUMENT_POSITION_DISCONNECTED;
		var n = [];
		h(this._fragmentFiber.child, !1, Hp, n, void 0, void 0);
		var r = b(t);
		if (n.length === 0) {
			if (n = r, _(this._fragmentFiber)) {
				a: {
					for (t = this._fragmentFiber.return; t !== null;) {
						if (t.tag === 4) {
							t = t.stateNode.containerInfo;
							break a;
						}
						if (t.tag === 3 || t.tag === 5 || t.tag === 27) break;
						t = t.return;
					}
					t = null;
				}
				t != null && (n = t);
			}
			t = this._fragmentFiber;
			var i = r = n.compareDocumentPosition(e);
			return n === e ? i = Node.DOCUMENT_POSITION_CONTAINS : r & Node.DOCUMENT_POSITION_CONTAINED_BY && (n = v(t)[1], n === null ? i = Node.DOCUMENT_POSITION_PRECEDING : (e = b(n).compareDocumentPosition(e), i = e === 0 || e & Node.DOCUMENT_POSITION_FOLLOWING ? Node.DOCUMENT_POSITION_FOLLOWING : Node.DOCUMENT_POSITION_PRECEDING)), i |= Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC;
		}
		t = b(n[0]), i = b(n[n.length - 1]);
		var a = _(this._fragmentFiber) ? t.parentElement : r;
		if (a == null) return Node.DOCUMENT_POSITION_DISCONNECTED;
		r = a.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_CONTAINED_BY, a = a.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_CONTAINED_BY;
		var o = t.compareDocumentPosition(e), s = i.compareDocumentPosition(e), c = o & Node.DOCUMENT_POSITION_CONTAINED_BY || s & Node.DOCUMENT_POSITION_CONTAINED_BY;
		return s = r && a && o & Node.DOCUMENT_POSITION_FOLLOWING && s & Node.DOCUMENT_POSITION_PRECEDING, t = r && t === e || a && i === e || c || s ? Node.DOCUMENT_POSITION_CONTAINED_BY : !r && t === e || !a && i === e ? Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC : o, t & Node.DOCUMENT_POSITION_DISCONNECTED || t & Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC || Xp(t, this._fragmentFiber, n[0], n[n.length - 1], e) ? t : Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC;
	};
	function Xp(e, t, n, r, i) {
		var a = jt(i);
		if (e & Node.DOCUMENT_POSITION_CONTAINED_BY) {
			if (n = !!a) a: {
				for (; a !== null;) {
					if (a.tag === 7 && (a === t || a.alternate === t)) {
						n = !0;
						break a;
					}
					a = a.return;
				}
				n = !1;
			}
			return n;
		}
		if (e & Node.DOCUMENT_POSITION_CONTAINS) {
			if (a === null) return a = i.ownerDocument, i === a || i === a.documentElement || i === a.body;
			a: {
				for (a = t, t = g(t); a !== null;) {
					if (!(a.tag !== 5 && a.tag !== 3 && a.tag !== 27 || a !== t && a.alternate !== t)) {
						a = !0;
						break a;
					}
					a = a.return;
				}
				a = !1;
			}
			return a;
		}
		return e & Node.DOCUMENT_POSITION_PRECEDING ? ((t = !!a) && !(t = a === n) && (t = te(n, a, w), t === null ? t = !1 : (h(t, !0, ee, a, n), a = x, x = null, t = a !== null)), t) : e & Node.DOCUMENT_POSITION_FOLLOWING ? ((t = !!a) && !(t = a === r) && (t = te(r, a, w), t === null ? t = !1 : (h(t, !0, C, a, r), a = x, S = x = null, t = a !== null)), t) : !1;
	}
	function Zp(e, t) {
		var n = e.ownerDocument.createRange();
		n.selectNodeContents(e), e = n.getBoundingClientRect(), window.scrollTo(window.scrollX + e.left, t ? window.scrollY + e.top : window.scrollY + e.bottom - window.innerHeight);
	}
	Fp.prototype.scrollIntoView = function(e) {
		if (typeof e == "object") throw Error(s(566));
		var t = [];
		h(this._fragmentFiber.child, !1, Hp, t, void 0, void 0);
		var n = !1 !== e;
		if (t.length === 0) {
			var r = v(this._fragmentFiber);
			if (r = n ? r[1] || r[0] || g(this._fragmentFiber) : r[0] || r[1], r === null) return;
			if (r.tag === 6) {
				e = b(r), Zp(e, n);
				return;
			}
			if (r = b(r), r.nodeType !== 9) {
				if (r.nodeType === 11) {
					n = "host" in r ? r.host : null, n !== null && n.scrollIntoView(e);
					return;
				}
				r.scrollIntoView(e);
			}
		}
		for (r = n ? t.length - 1 : 0; r !== (n ? -1 : t.length);) {
			var i = t[r];
			i.tag === 6 ? (i = b(i), Zp(i, n)) : b(i).scrollIntoView(e), r += n ? -1 : 1;
		}
	};
	function Qp(e, t) {
		return e = b(e), $p(e, t), !1;
	}
	function $p(e, t) {
		e.reactFragments ??= /* @__PURE__ */ new Set(), e.reactFragments.add(t);
	}
	function em(e, t) {
		var n = t._eventListeners;
		if (n !== null) for (var r = 0; r < n.length; r++) {
			var i = n[r];
			e.addEventListener(i.type, i.attachedListener, Rp(i.optionsOrUseCapture));
		}
		e.nodeType !== 3 && (n = t._observers, n !== null && n.forEach(function(n) {
			for (var r = 0, i = 0; i < Kp.length; i++) {
				var a = Kp[i];
				(a.fragmentInstance !== t || a.observer !== n || a.instance !== e) && (Kp[r++] = a);
			}
			Kp.length = r, n.observe(e);
		}), $p(e, t));
	}
	function tm(e, t) {
		var n = t._eventListeners;
		if (n !== null) for (var r = 0; r < n.length; r++) {
			var i = n[r];
			e.removeEventListener(i.type, i.attachedListener, Rp(i.optionsOrUseCapture));
		}
		e.nodeType !== 3 && (n = t._observers, n !== null && n.forEach(function(n) {
			typeof n.rootMargin == "string" ? Jp(t, n, e) : n.unobserve(e);
		}), e.reactFragments != null && e.reactFragments.delete(t));
	}
	function nm(e) {
		var t = e.firstChild;
		for (t && t.nodeType === 10 && (t = t.nextSibling); t;) {
			var n = t;
			switch (t = t.nextSibling, n.nodeName) {
				case "HTML":
				case "HEAD":
				case "BODY":
					nm(n), At(n);
					continue;
				case "SCRIPT":
				case "STYLE": continue;
				case "LINK": if (n.rel.toLowerCase() === "stylesheet") continue;
			}
			e.removeChild(n);
		}
	}
	function rm(e, t, n, r) {
		for (; e.nodeType === 1;) {
			var i = n;
			if (e.nodeName.toLowerCase() !== t.toLowerCase()) {
				if (!r && (e.nodeName !== "INPUT" || e.type !== "hidden")) break;
			} else if (!r) {
				if (t === "input" && e.type === "hidden") {
					var a = i.name == null ? null : "" + i.name;
					if (i.type === "hidden" && e.getAttribute("name") === a) return e;
				} else return e;
			} else if (!e[Ot]) switch (t) {
				case "meta":
					if (!e.hasAttribute("itemprop")) break;
					return e;
				case "link":
					if (a = e.getAttribute("rel"), a === "stylesheet" && e.hasAttribute("data-precedence") || a !== i.rel || e.getAttribute("href") !== (i.href == null || i.href === "" ? null : i.href) || e.getAttribute("crossorigin") !== (i.crossOrigin == null ? null : i.crossOrigin) || e.getAttribute("title") !== (i.title == null ? null : i.title)) break;
					return e;
				case "style":
					if (e.hasAttribute("data-precedence")) break;
					return e;
				case "script":
					if (a = e.getAttribute("src"), (a !== (i.src == null ? null : i.src) || e.getAttribute("type") !== (i.type == null ? null : i.type) || e.getAttribute("crossorigin") !== (i.crossOrigin == null ? null : i.crossOrigin)) && a && e.hasAttribute("async") && !e.hasAttribute("itemprop")) break;
					return e;
				default: return e;
			}
			if (e = lm(e.nextSibling), e === null) break;
		}
		return null;
	}
	function im(e, t, n) {
		if (t === "") return null;
		for (; e.nodeType !== 3;) if ((e.nodeType !== 1 || e.nodeName !== "INPUT" || e.type !== "hidden") && !n || (e = lm(e.nextSibling), e === null)) return null;
		return e;
	}
	function am(e, t) {
		for (; e.nodeType !== 8;) if ((e.nodeType !== 1 || e.nodeName !== "INPUT" || e.type !== "hidden") && !t || (e = lm(e.nextSibling), e === null)) return null;
		return e;
	}
	function om(e) {
		return e.data === "$?" || e.data === "$~";
	}
	function sm(e) {
		return e.data === "$!" || e.data === "$?" && e.ownerDocument.readyState !== "loading";
	}
	function cm(e, t) {
		var n = e.ownerDocument;
		if (e.data === "$~") e._reactRetry = t;
		else if (e.data !== "$?" || n.readyState !== "loading") t();
		else {
			var r = function() {
				t(), n.removeEventListener("DOMContentLoaded", r);
			};
			n.addEventListener("DOMContentLoaded", r), e._reactRetry = r;
		}
	}
	function lm(e) {
		for (; e != null; e = e.nextSibling) {
			var t = e.nodeType;
			if (t === 1 || t === 3) break;
			if (t === 8) {
				if (t = e.data, t === "$" || t === "$!" || t === "$?" || t === "$~" || t === "&" || t === "F!" || t === "F") break;
				if (t === "/$" || t === "/&") return null;
			}
		}
		return e;
	}
	var um = null;
	function dm(e) {
		e = e.nextSibling;
		for (var t = 0; e;) {
			if (e.nodeType === 8) {
				var n = e.data;
				if (n === "/$" || n === "/&") {
					if (t === 0) return lm(e.nextSibling);
					t--;
				} else n !== "$" && n !== "$!" && n !== "$?" && n !== "$~" && n !== "&" || t++;
			}
			e = e.nextSibling;
		}
		return null;
	}
	function fm(e) {
		e = e.previousSibling;
		for (var t = 0; e;) {
			if (e.nodeType === 8) {
				var n = e.data;
				if (n === "$" || n === "$!" || n === "$?" || n === "$~" || n === "&") {
					if (t === 0) return e;
					t--;
				} else n !== "/$" && n !== "/&" || t++;
			}
			e = e.previousSibling;
		}
		return null;
	}
	function pm(e, t) {
		function n() {
			r = !0;
		}
		if (e.ownerDocument.activeElement === e) return !0;
		var r = !1;
		try {
			e.ownerDocument.addEventListener("focus", n, !0), (e.focus || HTMLElement.prototype.focus).call(e, t);
		} finally {
			e.ownerDocument.removeEventListener("focus", n, !0);
		}
		return r;
	}
	function mm(e) {
		yp(function() {
			yp(function(t) {
				return e(t);
			});
		});
	}
	function hm(e, t, n) {
		switch (t = lp(n), e) {
			case "html":
				if (e = t.documentElement, !e) throw Error(s(452));
				return e;
			case "head":
				if (e = t.head, !e) throw Error(s(453));
				return e;
			case "body":
				if (e = t.body, !e) throw Error(s(454));
				return e;
			default: throw Error(s(451));
		}
	}
	function gm(e, t, n) {
		for (var r in n) {
			var i = n[r];
			n.hasOwnProperty(r) && i != null && $(e, t, r, null, rp, i);
		}
		n.dangerouslySetInnerHTML != null && (e.textContent = ""), e.onclick === gn && (e.onclick = null), At(e);
	}
	function _m(e) {
		for (var t = e.attributes; t.length;) e.removeAttributeNode(t[0]);
		At(e);
	}
	var vm = /* @__PURE__ */ new Map(), ym = /* @__PURE__ */ new Set();
	function bm(e) {
		if (typeof e.getRootNode == "function") {
			var t = e.getRootNode();
			if (t.nodeType === 9 || t.nodeType === 11) return t;
		}
		return e.nodeType === 9 ? e : e.ownerDocument;
	}
	var xm = A.d;
	A.d = {
		f: Sm,
		r: Cm,
		D: Em,
		C: Dm,
		L: Om,
		m: km,
		X: jm,
		S: Am,
		M: Mm
	};
	function Sm() {
		var e = xm.f(), t = zd();
		return e || t;
	}
	function Cm(e) {
		var t = Mt(e);
		t !== null && t.tag === 5 && t.type === "form" ? ec(t) : xm.r(e);
	}
	var wm = typeof document > "u" ? null : document;
	function Tm(e, t, n) {
		var r = wm;
		if (r && typeof t == "string" && t) {
			var i = en(t);
			i = "link[rel=\"" + e + "\"][href=\"" + i + "\"]", typeof n == "string" && (i += "[crossorigin=\"" + n + "\"]"), ym.has(i) || (ym.add(i), e = {
				rel: e,
				crossOrigin: n,
				href: t
			}, r.querySelector(i) === null && (t = r.createElement("link"), np(t, "link", e), Ft(t), r.head.appendChild(t)));
		}
	}
	function Em(e) {
		xm.D(e), Tm("dns-prefetch", e, null);
	}
	function Dm(e, t) {
		xm.C(e, t), Tm("preconnect", e, t);
	}
	function Om(e, t, n) {
		xm.L(e, t, n);
		var r = wm;
		if (r && e && t) {
			var i = "link[rel=\"preload\"][as=\"" + en(t) + "\"]";
			t === "image" && n && n.imageSrcSet ? (i += "[imagesrcset=\"" + en(n.imageSrcSet) + "\"]", typeof n.imageSizes == "string" && (i += "[imagesizes=\"" + en(n.imageSizes) + "\"]")) : i += "[href=\"" + en(e) + "\"]";
			var a = i;
			switch (t) {
				case "style":
					a = Pm(e);
					break;
				case "script": a = Rm(e);
			}
			if (!(vm.has(a) || (e = T({
				rel: "preload",
				href: t === "image" && n && n.imageSrcSet ? void 0 : e,
				as: t
			}, n), vm.set(a, e), r.querySelector(i) !== null || t === "style" && r.querySelector(Fm(a)) || t === "script" && r.querySelector(zm(a))))) {
				var o = r.createElement("link");
				np(o, "link", e), t === "style" && (o[kt] = !0, o.onload = o.onerror = function() {
					It(o);
				}), Ft(o), r.head.appendChild(o);
			}
		}
	}
	function km(e, t) {
		xm.m(e, t);
		var n = wm;
		if (n && e) {
			var r = t && typeof t.as == "string" ? t.as : "script", i = "link[rel=\"modulepreload\"][as=\"" + en(r) + "\"][href=\"" + en(e) + "\"]", a = i;
			switch (r) {
				case "audioworklet":
				case "paintworklet":
				case "serviceworker":
				case "sharedworker":
				case "worker":
				case "script": a = Rm(e);
			}
			if (!vm.has(a) && (e = T({
				rel: "modulepreload",
				href: e
			}, t), vm.set(a, e), n.querySelector(i) === null)) {
				switch (r) {
					case "audioworklet":
					case "paintworklet":
					case "serviceworker":
					case "sharedworker":
					case "worker":
					case "script": if (n.querySelector(zm(a))) return;
				}
				r = n.createElement("link"), np(r, "link", e), Ft(r), n.head.appendChild(r);
			}
		}
	}
	function Am(e, t, n) {
		xm.S(e, t, n);
		var r = wm;
		if (r && e) {
			var i = Pt(r).hoistableStyles, a = Pm(e);
			t ||= "default";
			var o = i.get(a);
			if (!o) {
				var s = {
					loading: 0,
					preload: null
				};
				if (o = r.querySelector(Fm(a))) s.loading = 5;
				else {
					e = T({
						rel: "stylesheet",
						href: e,
						"data-precedence": t
					}, n), (n = vm.get(a)) && Hm(e, n);
					var c = o = r.createElement("link");
					Ft(c), np(c, "link", e), c._p = new Promise(function(e, t) {
						c.onload = e, c.onerror = t;
					}), c.addEventListener("load", function() {
						s.loading |= 1;
					}), c.addEventListener("error", function() {
						s.loading |= 2;
					}), s.loading |= 4, Vm(o, t, r);
				}
				o = {
					type: "stylesheet",
					instance: o,
					count: 1,
					state: s
				}, i.set(a, o);
			}
		}
	}
	function jm(e, t) {
		xm.X(e, t);
		var n = wm;
		if (n && e) {
			var r = Pt(n).hoistableScripts, i = Rm(e), a = r.get(i);
			a || (a = n.querySelector(zm(i)), a || (e = T({
				src: e,
				async: !0
			}, t), (t = vm.get(i)) && Um(e, t), a = n.createElement("script"), Ft(a), np(a, "link", e), n.head.appendChild(a)), a = {
				type: "script",
				instance: a,
				count: 1,
				state: null
			}, r.set(i, a));
		}
	}
	function Mm(e, t) {
		xm.M(e, t);
		var n = wm;
		if (n && e) {
			var r = Pt(n).hoistableScripts, i = Rm(e), a = r.get(i);
			a || (a = n.querySelector(zm(i)), a || (e = T({
				src: e,
				async: !0,
				type: "module"
			}, t), (t = vm.get(i)) && Um(e, t), a = n.createElement("script"), Ft(a), np(a, "link", e), n.head.appendChild(a)), a = {
				type: "script",
				instance: a,
				count: 1,
				state: null
			}, r.set(i, a));
		}
	}
	function Nm(e, t, n, r) {
		var i = (i = Oe.current) ? bm(i) : null;
		if (!i) throw Error(s(446));
		switch (e) {
			case "meta":
			case "title": return null;
			case "style": return typeof n.precedence == "string" && typeof n.href == "string" ? (n = Pm(n.href), t = Pt(i).hoistableStyles, r = t.get(n), r || (r = {
				type: "style",
				instance: null,
				count: 0,
				state: null
			}, t.set(n, r)), r) : {
				type: "void",
				instance: null,
				count: 0,
				state: null
			};
			case "link":
				if (n.rel === "stylesheet" && typeof n.href == "string" && typeof n.precedence == "string") {
					e = Pm(n.href);
					var a = Pt(i).hoistableStyles, o = a.get(e);
					if (o || (i = i.ownerDocument || i, o = {
						type: "stylesheet",
						instance: null,
						count: 0,
						state: {
							loading: 0,
							preload: null
						}
					}, a.set(e, o), (a = i.querySelector(Fm(e))) ? a._p || (o.instance = a, o.state.loading = 5) : (a = vm.get(e), a || (a = {
						rel: "preload",
						as: "style",
						href: n.href,
						crossOrigin: n.crossOrigin,
						integrity: n.integrity,
						media: n.media,
						hrefLang: n.hrefLang,
						referrerPolicy: n.referrerPolicy
					}, vm.set(e, a)), Lm(i, e, a, o.state))), t && r === null) throw Error(s(528, ""));
					return o;
				}
				if (t && r !== null) throw Error(s(529, ""));
				return null;
			case "script": return t = n.async, n = n.src, typeof n == "string" && t && typeof t != "function" && typeof t != "symbol" ? (n = Rm(n), t = Pt(i).hoistableScripts, r = t.get(n), r || (r = {
				type: "script",
				instance: null,
				count: 0,
				state: null
			}, t.set(n, r)), r) : {
				type: "void",
				instance: null,
				count: 0,
				state: null
			};
			default: throw Error(s(444, e));
		}
	}
	function Pm(e) {
		return "href=\"" + en(e) + "\"";
	}
	function Fm(e) {
		return "link[rel=\"stylesheet\"][" + e + "]";
	}
	function Im(e) {
		return T({}, e, {
			"data-precedence": e.precedence,
			precedence: null
		});
	}
	function Lm(e, t, n, r) {
		if (t = e.querySelector("link[rel=\"preload\"][as=\"style\"][" + t + "]")) {
			if (!0 !== t[kt]) {
				r.loading = 1;
				return;
			}
		} else t = e.createElement("link"), t[kt] = !0, t.onload = t.onerror = It.bind(null, t), np(t, "link", n), Ft(t), e.head.appendChild(t);
		r.preload = t, t.addEventListener("load", function() {
			return r.loading |= 1;
		}), t.addEventListener("error", function() {
			return r.loading |= 2;
		});
	}
	function Rm(e) {
		return "[src=\"" + en(e) + "\"]";
	}
	function zm(e) {
		return "script[async]" + e;
	}
	function Bm(e, t, n) {
		if (t.count++, t.instance === null) switch (t.type) {
			case "style":
				var r = e.querySelector("style[data-href~=\"" + en(n.href) + "\"]");
				if (r) return t.instance = r, Ft(r), r;
				var i = T({}, n, {
					"data-href": n.href,
					"data-precedence": n.precedence,
					href: null,
					precedence: null
				});
				return r = (e.ownerDocument || e).createElement("style"), Ft(r), np(r, "style", i), Vm(r, n.precedence, e), t.instance = r;
			case "stylesheet":
				i = Pm(n.href);
				var a = e.querySelector(Fm(i));
				if (a) return t.state.loading |= 4, t.instance = a, Ft(a), a;
				r = Im(n), (i = vm.get(i)) && Hm(r, i), a = (e.ownerDocument || e).createElement("link"), Ft(a);
				var o = a;
				return o._p = new Promise(function(e, t) {
					o.onload = e, o.onerror = t;
				}), np(a, "link", r), t.state.loading |= 4, Vm(a, n.precedence, e), t.instance = a;
			case "script": return a = Rm(n.src), (i = e.querySelector(zm(a))) ? (t.instance = i, Ft(i), i) : (r = n, (i = vm.get(a)) && (r = T({}, n), Um(r, i)), e = e.ownerDocument || e, i = e.createElement("script"), Ft(i), np(i, "link", r), e.head.appendChild(i), t.instance = i);
			case "void": return null;
			default: throw Error(s(443, t.type));
		}
		else t.type === "stylesheet" && !(t.state.loading & 4) && (r = t.instance, t.state.loading |= 4, Vm(r, n.precedence, e));
		return t.instance;
	}
	function Vm(e, t, n) {
		for (var r = n.querySelectorAll("link[rel=\"stylesheet\"][data-precedence],style[data-precedence]"), i = r.length ? r[r.length - 1] : null, a = i, o = 0; o < r.length; o++) {
			var s = r[o];
			if (s.dataset.precedence === t) a = s;
			else if (a !== i) break;
		}
		a ? a.parentNode.insertBefore(e, a.nextSibling) : (t = n.nodeType === 9 ? n.head : n, t.insertBefore(e, t.firstChild));
	}
	function Hm(e, t) {
		e.crossOrigin ??= t.crossOrigin, e.referrerPolicy ??= t.referrerPolicy, e.title ??= t.title;
	}
	function Um(e, t) {
		e.crossOrigin ??= t.crossOrigin, e.referrerPolicy ??= t.referrerPolicy, e.integrity ??= t.integrity;
	}
	var Wm = null;
	function Gm(e, t, n) {
		if (Wm === null) {
			var r = /* @__PURE__ */ new Map(), i = Wm = /* @__PURE__ */ new Map();
			i.set(n, r);
		} else i = Wm, r = i.get(n), r || (r = /* @__PURE__ */ new Map(), i.set(n, r));
		if (r.has(e)) return r;
		for (r.set(e, null), n = n.getElementsByTagName(e), i = 0; i < n.length; i++) {
			var a = n[i];
			if (!(a[Ot] || a[R] || e === "link" && a.getAttribute("rel") === "stylesheet") && a.namespaceURI !== "http://www.w3.org/2000/svg") {
				var o = a.getAttribute(t) || "";
				o = e + o;
				var s = r.get(o);
				s ? s.push(a) : r.set(o, [a]);
			}
		}
		return r;
	}
	function Km(e, t, n) {
		e = e.ownerDocument || e, e.head.insertBefore(n, t === "title" ? e.querySelector("head > title") : null);
	}
	function qm(e, t, n) {
		if (n === 1 || t.itemProp != null) return !1;
		switch (e) {
			case "meta":
			case "title": return !0;
			case "style":
				if (typeof t.precedence != "string" || typeof t.href != "string" || t.href === "") break;
				return !0;
			case "link":
				if (typeof t.rel != "string" || typeof t.href != "string" || t.href === "" || t.onLoad || t.onError) break;
				switch (t.rel) {
					case "stylesheet": return e = t.disabled, typeof t.precedence == "string" && e == null;
					default: return !0;
				}
			case "script": if (t.async && typeof t.async != "function" && typeof t.async != "symbol" && !t.onLoad && !t.onError && t.src && typeof t.src == "string") return !0;
		}
		return !1;
	}
	function Jm(e, t) {
		return e === "img" && t.src != null && t.src !== "" && t.onLoad == null && t.loading !== "lazy";
	}
	function Ym(e) {
		return !(e.type === "stylesheet" && !(e.state.loading & 3));
	}
	function Xm(e) {
		return (e.width || 100) * (e.height || 100) * (typeof devicePixelRatio == "number" ? devicePixelRatio : 1) * .25;
	}
	function Zm(e, t) {
		typeof t.decode == "function" && (e.imgCount++, t.complete || (e.imgBytes += Xm(t), e.suspenseyImages.push(t)), e = rh.bind(e), t.decode().then(e, e));
	}
	function Qm(e, t, n, r) {
		if (n.type === "stylesheet" && (typeof r.media != "string" || !1 !== matchMedia(r.media).matches) && !(n.state.loading & 4)) {
			if (n.instance === null) {
				var i = Pm(r.href), a = t.querySelector(Fm(i));
				if (a) {
					t = a._p, typeof t == "object" && t && typeof t.then == "function" && (e.count++, e = nh.bind(e), t.then(e, e)), n.state.loading |= 4, n.instance = a, Ft(a);
					return;
				}
				a = t.ownerDocument || t, r = Im(r), (i = vm.get(i)) && Hm(r, i), a = a.createElement("link"), Ft(a);
				var o = a;
				o._p = new Promise(function(e, t) {
					o.onload = e, o.onerror = t;
				}), np(a, "link", r), n.instance = a;
			}
			e.stylesheets === null && (e.stylesheets = /* @__PURE__ */ new Map()), e.stylesheets.set(n, t), (t = n.state.preload) && !(n.state.loading & 3) && (e.count++, n = nh.bind(e), t.addEventListener("load", n), t.addEventListener("error", n));
		}
	}
	var $m = 0;
	function eh(e, t) {
		return e.stylesheets && e.count === 0 && ah(e, e.stylesheets), 0 < e.count || 0 < e.imgCount ? function(n) {
			var r = setTimeout(function() {
				if (e.stylesheets && ah(e, e.stylesheets), e.unsuspend) {
					var t = e.unsuspend;
					e.unsuspend = null, t();
				}
			}, 6e4 + t);
			0 < e.imgBytes && $m === 0 && ($m = 62500 * op());
			var i = setTimeout(function() {
				if (e.waitingForImages = !1, e.count === 0 && (e.stylesheets && ah(e, e.stylesheets), e.unsuspend)) {
					var t = e.unsuspend;
					e.unsuspend = null, t();
				}
			}, (e.imgBytes > $m ? 50 : 800) + t);
			return e.unsuspend = n, function() {
				e.unsuspend = null, clearTimeout(r), clearTimeout(i);
			};
		} : null;
	}
	function th(e) {
		if (e.count === 0 && (e.imgCount === 0 || !e.waitingForImages)) {
			if (e.stylesheets) ah(e, e.stylesheets);
			else if (e.unsuspend) {
				var t = e.unsuspend;
				e.unsuspend = null, t();
			}
		}
	}
	function nh() {
		this.count--, th(this);
	}
	function rh() {
		this.imgCount--, th(this);
	}
	var ih = null;
	function ah(e, t) {
		e.stylesheets = null, e.unsuspend !== null && (e.count++, ih = /* @__PURE__ */ new Map(), t.forEach(oh, e), ih = null, nh.call(e));
	}
	function oh(e, t) {
		if (!(t.state.loading & 4)) {
			var n = ih.get(e);
			if (n) var r = n.get(null);
			else {
				n = /* @__PURE__ */ new Map(), ih.set(e, n);
				for (var i = e.querySelectorAll("link[data-precedence],style[data-precedence]"), a = 0; a < i.length; a++) {
					var o = i[a];
					(o.nodeName === "LINK" || o.getAttribute("media") !== "not all") && (n.set(o.dataset.precedence, o), r = o);
				}
				r && n.set(null, r);
			}
			i = t.instance, o = i.getAttribute("data-precedence"), a = n.get(o) || r, a === r && n.set(null, i), n.set(o, i), this.count++, r = nh.bind(this), i.addEventListener("load", r), i.addEventListener("error", r), a ? a.parentNode.insertBefore(i, a.nextSibling) : (e = e.nodeType === 9 ? e.head : e, e.insertBefore(i, e.firstChild)), t.state.loading |= 4;
		}
	}
	var sh = {
		$$typeof: ce,
		Provider: null,
		Consumer: null,
		_currentValue: j,
		_currentValue2: j,
		_threadCount: 0
	};
	function ch(e, t, n, r, i, a, o, s, c) {
		this.tag = 1, this.containerInfo = e, this.pingCache = this.current = this.pendingChildren = null, this.timeoutHandle = -1, this.callbackNode = this.next = this.pendingContext = this.context = this.cancelPendingCommit = null, this.callbackPriority = 0, this.expirationTimes = mt(-1), this.entangledLanes = this.shellSuspendCounter = this.errorRecoveryDisabledLanes = this.expiredLanes = this.warmLanes = this.pingedLanes = this.suspendedLanes = this.pendingLanes = 0, this.entanglements = mt(0), this.hiddenUpdates = mt(null), this.identifierPrefix = r, this.onUncaughtError = i, this.onCaughtError = a, this.onRecoverableError = o, this.pooledCache = null, this.pooledCacheLanes = 0, this.formState = c, this.transitionTypes = null, this.incompleteTransitions = /* @__PURE__ */ new Map();
	}
	function lh(e, t, n, r, i, a, o, s, c, l, u, d) {
		return e = new ch(e, t, n, o, c, l, u, d, s), t = 1, !0 === a && (t |= 24), a = ki(3, null, null, t), e.current = a, a.stateNode = e, t = ka(), t.refCount++, e.pooledCache = t, t.refCount++, a.memoizedState = {
			element: r,
			isDehydrated: n,
			cache: t
		}, fo(a), e;
	}
	function uh(e) {
		return e ? (e = Di, e) : Di;
	}
	function dh(e, t, n, r, i, a) {
		i = uh(i), r.context === null ? r.context = i : r.pendingContext = i, r = mo(t), r.payload = { element: n }, a = a === void 0 ? null : a, a !== null && (r.callback = a), n = ho(e, r, t), n !== null && (Pd(n, e, t), go(n, e, t));
	}
	function fh(e, t) {
		if (e = e.memoizedState, e !== null && e.dehydrated !== null) {
			var n = e.retryLane;
			e.retryLane = n !== 0 && n < t ? n : t;
		}
	}
	function ph(e, t) {
		fh(e, t), (e = e.alternate) && fh(e, t);
	}
	function mh(e) {
		if (e.tag === 13 || e.tag === 31) {
			var t = wi(e, 67108864);
			t !== null && Pd(t, e, 67108864), ph(e, 67108864);
		}
	}
	function hh(e) {
		if (e.tag === 13 || e.tag === 31) {
			var t = jd();
			t = L(t);
			var n = wi(e, t);
			n !== null && Pd(n, e, t), ph(e, t);
		}
	}
	var gh = !0;
	function _h(e, t, n, r) {
		var i = k.T;
		k.T = null;
		var a = A.p;
		try {
			A.p = 2, yh(e, t, n, r);
		} finally {
			A.p = a, k.T = i;
		}
	}
	function vh(e, t, n, r) {
		var i = k.T;
		k.T = null;
		var a = A.p;
		try {
			A.p = 8, yh(e, t, n, r);
		} finally {
			A.p = a, k.T = i;
		}
	}
	function yh(e, t, n, r) {
		if (gh) {
			var i = bh(r);
			if (i === null) Kf(e, t, r, xh, n), Mh(e, r);
			else if (Ph(i, e, t, n, r)) r.stopPropagation();
			else if (Mh(e, r), t & 4 && -1 < jh.indexOf(e)) {
				for (; i !== null;) {
					var a = Mt(i);
					if (a !== null) switch (a.tag) {
						case 3:
							if (a = a.stateNode, a.current.memoizedState.isDehydrated) {
								var o = ct(a.pendingLanes);
								if (o !== 0) {
									var s = a;
									for (s.pendingLanes |= 2, s.entangledLanes |= 2; o;) {
										var c = 1 << 31 - tt(o);
										s.entanglements[1] |= c, o &= ~c;
									}
									Ef(a), !(q & 6) && (gd = We() + 500, Df(0, !1));
								}
							}
							break;
						case 31:
						case 13: s = wi(a, 2), s !== null && Pd(s, a, 2), zd(), ph(a, 2);
					}
					if (a = bh(r), a === null && Kf(e, t, r, xh, n), a === i) break;
					i = a;
				}
				i !== null && r.stopPropagation();
			} else Kf(e, t, r, null, n);
		}
	}
	function bh(e) {
		return e = vn(e), Sh(e);
	}
	var xh = null;
	function Sh(e) {
		if (xh = null, e = jt(e), e !== null) {
			var t = l(e);
			if (t === null) e = null;
			else {
				var n = t.tag;
				if (n === 13) {
					if (e = u(t), e !== null) return e;
					e = null;
				} else if (n === 31) {
					if (e = d(t), e !== null) return e;
					e = null;
				} else if (n === 3) {
					if (t.stateNode.current.memoizedState.isDehydrated) return t.tag === 3 ? t.stateNode.containerInfo : null;
					e = null;
				} else t !== e && (e = null);
			}
		}
		return xh = e, null;
	}
	function Ch(e) {
		switch (e) {
			case "beforetoggle":
			case "cancel":
			case "click":
			case "close":
			case "contextmenu":
			case "copy":
			case "cut":
			case "auxclick":
			case "dblclick":
			case "dragend":
			case "dragstart":
			case "drop":
			case "focusin":
			case "focusout":
			case "input":
			case "invalid":
			case "keydown":
			case "keypress":
			case "keyup":
			case "mousedown":
			case "mouseup":
			case "paste":
			case "pause":
			case "play":
			case "pointercancel":
			case "pointerdown":
			case "pointerup":
			case "ratechange":
			case "reset":
			case "seeked":
			case "submit":
			case "toggle":
			case "touchcancel":
			case "touchend":
			case "touchstart":
			case "volumechange":
			case "change":
			case "selectionchange":
			case "textInput":
			case "compositionstart":
			case "compositionend":
			case "compositionupdate":
			case "beforeblur":
			case "afterblur":
			case "beforeinput":
			case "blur":
			case "fullscreenchange":
			case "fullscreenerror":
			case "focus":
			case "hashchange":
			case "popstate":
			case "select":
			case "selectstart": return 2;
			case "drag":
			case "dragenter":
			case "dragexit":
			case "dragleave":
			case "dragover":
			case "mousemove":
			case "mouseout":
			case "mouseover":
			case "pointermove":
			case "pointerout":
			case "pointerover":
			case "resize":
			case "scroll":
			case "touchmove":
			case "wheel":
			case "mouseenter":
			case "mouseleave":
			case "pointerenter":
			case "pointerleave": return 8;
			case "message": switch (Ge()) {
				case Ke: return 2;
				case qe: return 8;
				case Je:
				case Ye: return 32;
				case Xe: return 268435456;
				default: return 32;
			}
			default: return 32;
		}
	}
	var wh = !1, Th = null, Eh = null, Dh = null, Oh = /* @__PURE__ */ new Map(), kh = /* @__PURE__ */ new Map(), Ah = [], jh = "mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset".split(" ");
	function Mh(e, t) {
		switch (e) {
			case "focusin":
			case "focusout":
				Th = null;
				break;
			case "dragenter":
			case "dragleave":
				Eh = null;
				break;
			case "mouseover":
			case "mouseout":
				Dh = null;
				break;
			case "pointerover":
			case "pointerout":
				Oh.delete(t.pointerId);
				break;
			case "gotpointercapture":
			case "lostpointercapture": kh.delete(t.pointerId);
		}
	}
	function Nh(e, t, n, r, i, a) {
		return e === null || e.nativeEvent !== a ? (e = {
			blockedOn: t,
			domEventName: n,
			eventSystemFlags: r,
			nativeEvent: a,
			targetContainers: [i]
		}, t !== null && (t = Mt(t), t !== null && mh(t)), e) : (e.eventSystemFlags |= r, t = e.targetContainers, i !== null && t.indexOf(i) === -1 && t.push(i), e);
	}
	function Ph(e, t, n, r, i) {
		switch (t) {
			case "focusin": return Th = Nh(Th, e, t, n, r, i), !0;
			case "dragenter": return Eh = Nh(Eh, e, t, n, r, i), !0;
			case "mouseover": return Dh = Nh(Dh, e, t, n, r, i), !0;
			case "pointerover":
				var a = i.pointerId;
				return Oh.set(a, Nh(Oh.get(a) || null, e, t, n, r, i)), !0;
			case "gotpointercapture": return a = i.pointerId, kh.set(a, Nh(kh.get(a) || null, e, t, n, r, i)), !0;
		}
		return !1;
	}
	function Fh(e) {
		var t = jt(e.target);
		if (t !== null) {
			var n = l(t);
			if (n !== null) {
				if (t = n.tag, t === 13) {
					if (t = u(n), t !== null) {
						e.blockedOn = t, xt(e.priority, function() {
							hh(n);
						});
						return;
					}
				} else if (t === 31) {
					if (t = d(n), t !== null) {
						e.blockedOn = t, xt(e.priority, function() {
							hh(n);
						});
						return;
					}
				} else if (t === 3 && n.stateNode.current.memoizedState.isDehydrated) {
					e.blockedOn = n.tag === 3 ? n.stateNode.containerInfo : null;
					return;
				}
			}
		}
		e.blockedOn = null;
	}
	function Ih(e) {
		if (e.blockedOn !== null) return !1;
		for (var t = e.targetContainers; 0 < t.length;) {
			var n = bh(e.nativeEvent);
			if (n === null) {
				n = e.nativeEvent;
				var r = new n.constructor(n.type, n);
				_n = r, n.target.dispatchEvent(r), _n = null;
			} else return t = Mt(n), t !== null && mh(t), e.blockedOn = n, !1;
			t.shift();
		}
		return !0;
	}
	function Lh(e, t, n) {
		Ih(e) && n.delete(t);
	}
	function Rh() {
		wh = !1, Th !== null && Ih(Th) && (Th = null), Eh !== null && Ih(Eh) && (Eh = null), Dh !== null && Ih(Dh) && (Dh = null), Oh.forEach(Lh), kh.forEach(Lh);
	}
	function zh(e, n) {
		e.blockedOn === n && (e.blockedOn = null, wh || (wh = !0, t.unstable_scheduleCallback(t.unstable_NormalPriority, Rh)));
	}
	var Bh = null;
	function Vh(e) {
		Bh !== e && (Bh = e, t.unstable_scheduleCallback(t.unstable_NormalPriority, function() {
			Bh === e && (Bh = null);
			for (var t = 0; t < e.length; t += 3) {
				var n = e[t], r = e[t + 1], i = e[t + 2];
				if (typeof r != "function") {
					if (Sh(r || n) === null) continue;
					break;
				}
				var a = Mt(n);
				a !== null && (e.splice(t, 3), t -= 3, Qs(a, {
					pending: !0,
					data: i,
					method: n.method,
					action: r
				}, r, i));
			}
		}));
	}
	function Hh(e) {
		function t(t) {
			return zh(t, e);
		}
		Th !== null && zh(Th, e), Eh !== null && zh(Eh, e), Dh !== null && zh(Dh, e), Oh.forEach(t), kh.forEach(t);
		for (var n = 0; n < Ah.length; n++) {
			var r = Ah[n];
			r.blockedOn === e && (r.blockedOn = null);
		}
		for (; 0 < Ah.length && (n = Ah[0], n.blockedOn === null);) Fh(n), n.blockedOn === null && Ah.shift();
		if (n = (e.ownerDocument || e).$$reactFormReplay, n != null) for (r = 0; r < n.length; r += 3) {
			var i = n[r], a = n[r + 1], o = i[z] || null;
			if (typeof a == "function") o || Vh(n);
			else if (o) {
				var s = null;
				if (a && a.hasAttribute("formAction")) {
					if (i = a, o = a[z] || null) s = o.formAction;
					else if (Sh(i) !== null) continue;
				} else s = o.action;
				typeof s == "function" ? n[r + 1] = s : (n.splice(r, 3), r -= 3), Vh(n);
			}
		}
	}
	function Uh() {
		function e(e) {
			e.canIntercept && e.info === "react-transition" && e.intercept({
				handler: function() {
					return new Promise(function(e) {
						return i = e;
					});
				},
				focusReset: "manual",
				scroll: "manual"
			});
		}
		function t() {
			i !== null && (i(), i = null), r || setTimeout(n, 20);
		}
		function n() {
			if (!r && !navigation.transition) {
				var e = navigation.currentEntry;
				e && e.url != null && navigation.navigate(e.url, {
					state: e.getState(),
					info: "react-transition",
					history: "replace"
				});
			}
		}
		if (typeof navigation == "object") {
			var r = !1, i = null;
			return navigation.addEventListener("navigate", e), navigation.addEventListener("navigatesuccess", t), navigation.addEventListener("navigateerror", t), setTimeout(n, 100), function() {
				r = !0, navigation.removeEventListener("navigate", e), navigation.removeEventListener("navigatesuccess", t), navigation.removeEventListener("navigateerror", t), i !== null && (i(), i = null);
			};
		}
	}
	function Wh(e) {
		this._internalRoot = e;
	}
	Gh.prototype.render = Wh.prototype.render = function(e) {
		var t = this._internalRoot;
		if (t === null) throw Error(s(409));
		var n = t.current;
		dh(n, jd(), e, t, null, null);
	}, Gh.prototype.unmount = Wh.prototype.unmount = function() {
		var e = this._internalRoot;
		if (e !== null) {
			this._internalRoot = null;
			var t = e.containerInfo;
			dh(e.current, 2, null, e, null, null), zd(), t[Ct] = null;
		}
	};
	function Gh(e) {
		this._internalRoot = e;
	}
	Gh.prototype.unstable_scheduleHydration = function(e) {
		if (e) {
			var t = bt();
			e = {
				blockedOn: null,
				target: e,
				priority: t
			};
			for (var n = 0; n < Ah.length && t !== 0 && t < Ah[n].priority; n++);
			Ah.splice(n, 0, e), n === 0 && Fh(e);
		}
	};
	var Kh = r.version;
	if (Kh !== "19.3.1") throw Error(s(527, Kh, "19.3.1"));
	A.findDOMNode = function(e) {
		var t = e._reactInternals;
		if (t === void 0) throw typeof e.render == "function" ? Error(s(188)) : (e = Object.keys(e).join(","), Error(s(268, e)));
		return e = p(t), e = e === null ? null : m(e), e = e === null ? null : e.stateNode, e;
	};
	var qh = {
		bundleType: 0,
		version: "19.3.1",
		rendererPackageName: "react-dom",
		currentDispatcherRef: k,
		reconcilerVersion: "19.3.1"
	};
	if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u") {
		var Jh = __REACT_DEVTOOLS_GLOBAL_HOOK__;
		if (!Jh.isDisabled && Jh.supportsFiber) try {
			$e = Jh.inject(qh), et = Jh;
		} catch {}
	}
	e.createRoot = function(e, t) {
		if (!c(e)) throw Error(s(299));
		var n = !1, r = "", i = xc, a = Sc, o = Cc;
		return t != null && (!0 === t.unstable_strictMode && (n = !0), t.identifierPrefix !== void 0 && (r = t.identifierPrefix), t.onUncaughtError !== void 0 && (i = t.onUncaughtError), t.onCaughtError !== void 0 && (a = t.onCaughtError), t.onRecoverableError !== void 0 && (o = t.onRecoverableError)), t = lh(e, 1, !1, null, null, n, r, null, i, a, o, Uh), e[Ct] = t.current, Wf(e), new Wh(t);
	};
})), c = (/* @__PURE__ */ e(((e, t) => {
	function n() {
		if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u" && typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE == "function") try {
			__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(n);
		} catch (e) {
			console.error(e);
		}
	}
	n(), t.exports = s();
})))(), l = globalThis.__INSPECTOR_TOKEN__ ?? "", u = (e, t = {}) => fetch(e, {
	...t,
	headers: {
		...t.headers,
		"X-Inspector-Token": l
	}
}), d = null, f = (e) => void (d = e);
async function p(e, t = {}) {
	return d && t.method === "POST" && await d(e, typeof t.body == "string" ? t.body : ""), u(e, t);
}
var m = u, h = {
	i: "KeyI",
	"[": "BracketLeft",
	"]": "BracketRight"
};
function g(e, t) {
	return e.key.toLowerCase() === t || e.key.length === 1 && !/[\p{Script=Latin}\x00-\x7f]/u.test(e.key) && e.code === h[t];
}
// runtime/panel-src/inspector/tokenNames.ts
var _ = /^(colou?rs?|typography|type|fonts?|easing|motion|timing|spacing|sizes?|layout|tokens?|values?|other)$/i, v = {
	fs: "text size",
	lh: "line spacing",
	pitch: "line spacing",
	ls: "letter spacing",
	track: "letter spacing",
	tracking: "letter spacing",
	fw: "weight",
	ff: "font",
	px: "side padding",
	py: "top and bottom padding",
	pad: "padding",
	gap: "gap",
	r: "corner radius",
	radius: "corner radius",
	w: "width",
	h: "height",
	edge: "page edge",
	u: "unit",
	bg: "background",
	fg: "text colour",
	ink: "ink",
	dur: "duration",
	ms: "duration",
	delay: "delay",
	ease: "easing",
	z: "layer order",
	op: "opacity",
	alpha: "opacity",
	btn: "button",
	nav: "navigation",
	reg: "registered mark",
	lp: "LP tag",
	rule: "divider line"
}, y = /* @__PURE__ */ new Set([
	"text size",
	"line spacing",
	"letter spacing",
	"weight",
	"font",
	"side padding",
	"top and bottom padding",
	"padding",
	"gap",
	"corner radius",
	"width",
	"height",
	"duration",
	"delay",
	"easing",
	"opacity"
]), b = (e) => e.charAt(0).toUpperCase() + e.slice(1), x = /[,\s]+[−-]?\d[\d.]*\s*(px|em|rem|ms|s|%)?(\s*\(.*\))?$/i;
function S(e) {
	let t = e.trim();
	for (let e = 0; e < 3 && x.test(t); e++) t = t.replace(x, "").trim();
	return t.replace(/\bline pitch\b|\bpitch\b|\bleading\b|\bline height\b/gi, "line spacing").replace(/\btracking\b/gi, "letter spacing").replace(/,\s*$/, "").trim();
}
function ee(e, t) {
	let n = e.replace(/^--/, "").split(/[-_]/).filter(Boolean).map((e) => v[e] ?? e), r = n.filter((e) => y.has(e)), i = n.filter((e) => !y.has(e));
	return t === "color" && i.at(-1) === "text" && (i[i.length - 1] = "text colour"), b([...i, ...r].join(" ").trim() || e);
}
function C(e) {
	for (let t of e.replace(/^--/, "").split(/[-_]/)) {
		let e = v[t];
		if (e && y.has(e)) return e;
	}
	return null;
}
var w = {
	display: "Headline",
	heading: "Headline",
	headline: "Headline",
	title: "Headline",
	text: "Body",
	body: "Body",
	copy: "Body",
	sans: "Body",
	mono: "Code",
	code: "Code",
	serif: "Serif",
	accent: "Accent"
}, te = /^(typography|type|fonts?)$/i;
function T(e, t) {
	let n = t.role.split("›")[0].trim();
	if (t.kind !== "text" || !te.test(n) || C(e)) return null;
	let r = [...t.role.match(/\(([^)]+)\)/)?.[1].split(/[\s,/]+/) ?? [], ...e.replace(/^--/, "").split(/[-_]/)].map((e) => e.toLowerCase()).find((e) => w[e]);
	return r ? w[r] : "";
}
function ne(e) {
	if (e.length <= 32) return e;
	let t = e.split(/\s*[,(;—–]\s*/)[0].trim();
	return t.length >= 3 ? t : e;
}
function re(e, t) {
	if (t?.label) return t.label;
	if (!t?.role) return ee(e, t?.kind ?? "text");
	let n = T(e, t);
	if (n !== null) return n ? `${n} font` : "Font";
	let [r, ...i] = t.role.split("›").map((e) => e.trim()), a = i.join(" › ") || r, o = a.indexOf(":"), s = (o > 0 ? a.slice(0, o) : a).trim(), c = e.replace(/^--/, "");
	if (!s || s.replace(/^--/, "").toLowerCase() === c.toLowerCase() || s.length > 48) return ee(e, t.kind);
	s = ne(S(s)), i.length && !_.test(r) && !s.toLowerCase().includes(r.toLowerCase()) && (s = `${r} ${s.charAt(0).toLowerCase()}${s.slice(1)}`);
	let l = C(e), u = l && s.toLowerCase().includes(l.split(" ").at(-1) ?? l);
	return b(l && !u && t.kind !== "color" ? `${s} · ${l}` : s);
}
function ie(e, t = "") {
	if (!e?.role) return "";
	let n = e.role.split("›").slice(1).join("›").trim() || e.role;
	if (!e.label && T(t, e) !== null) return n.replace(/\s*\([^)]*\)/g, "").trim();
	let r = n.indexOf(":");
	return r > 0 ? n.slice(r + 1).trim() : "";
}
// runtime/panel-src/inspector/parts.ts
var E = i(), ae = [
	"section",
	"frame",
	"text",
	"image",
	"video",
	"button",
	"icon",
	"scene",
	"list"
], oe = (e) => !!e.motion || /^(m?s)$/.test(e.unit ?? ""), se = (e) => e.name ?? (e.nth ? `${e.find}#${e.nth}` : e.find ?? ""), ce = {
	version: 1,
	name: "site",
	facts: [],
	extraFiles: [],
	groups: [],
	parts: [],
	tokens: {}
}, le = (e) => e ? {
	...e,
	...Object.fromEntries(Object.entries(ce).map(([t, n]) => [t, e[t] ?? n]))
} : { ...ce }, D = le(globalThis.__DESIGN_MAP__), ue = D.tokens, de = D.extraFiles, O = [], fe = [], pe = (e) => ({
	id: "site",
	label: "Whole site",
	group: "Site",
	prompt: e.source?.template ? [{
		where: "Template",
		text: `${e.name}, built from ${e.source.template}.`
	}] : [{
		where: "Project",
		text: e.name
	}],
	tokens: [],
	files: e.parts.some((e) => e.edit.some((e) => /\.html?$/.test(e) && !e.startsWith("src/"))) ? [...new Set(e.parts.flatMap((e) => e.edit))] : [
		"src/",
		"index.html",
		"package.json"
	],
	edit: [],
	note: "Changes here run as a whole-project change: Claude Code reads what it needs, can add packages and files, and can change several parts at once.",
	outline: !1
}), me = /* @__PURE__ */ new Map(), he = null, ge = null, _e = !1, ve = 0, ye = (e) => e.parent && e.parent !== e.id && me.has(e.parent) ? e.parent : void 0, be = (e) => !(me.get(e)?.targets?.length ?? 0);
function xe(e) {
	let t = ye(e);
	if (!ge?.index.has(e.id) || t && be(t)) return t;
	let n = ge.parent.get(e.id);
	return n && n !== e.id && me.has(n) ? n : void 0;
}
function k(e) {
	let t = ge?.index;
	if (!t) return e;
	let n = e.filter((e) => t.has(e.id)).sort((e, n) => t.get(e.id) - t.get(n.id)), r = 0;
	return e.map((e) => t.has(e.id) ? n[r++] : e);
}
function A() {
	he && D.parts.some((e) => e.id === he?.id) && (he = null), O.splice(0, O.length, pe(D), ...D.parts.filter((e) => e.id !== "site"), ...he ? [he] : []), fe.splice(0, fe.length, ...new Set([
		"Site",
		...D.groups,
		...D.parts.map((e) => e.group)
	].filter(Boolean))), me = new Map(O.map((e) => [e.id, e])), _e = O.some((e) => xe(e));
}
A();
var j = (e) => e ? me.get(e) : void 0, Se = () => _e, Ce = (e) => k(O.filter((t) => (xe(t) ?? null) === e && t.id !== "site")), we = (e) => k(O.filter((t) => t.group === e));
function Te(e) {
	let t = [], n = me.get(e), r = /* @__PURE__ */ new Set();
	for (; n && xe(n) && !r.has(n.id);) r.add(n.id), n = me.get(xe(n)), n && t.unshift(n);
	return t;
}
var M = /* @__PURE__ */ new Set(), Ee = (e) => (M.add(e), () => void M.delete(e)), De = () => ve, Oe = () => (0, E.useSyncExternalStore)(Ee, De), ke = () => he, Ae = (e) => !!e && he?.id === e;
function je(e) {
	if ((e?.id ?? null) !== (he?.id ?? null)) {
		he = e, A(), ve++;
		for (let e of [...M]) e();
	}
}
function Me(e, t) {
	if (!(!he || he.targets?.[0]?.selector === e && he.label === t)) {
		he = {
			...he,
			label: t,
			targets: [{ selector: e }]
		}, A(), ve++;
		for (let e of [...M]) e();
	}
}
function Ne(e) {
	ge = e, _e = O.some((e) => xe(e)), ve++;
	for (let e of [...M]) e();
}
function Pe(e) {
	let t = le(e);
	for (let e of Object.keys(ue)) delete ue[e];
	Object.assign(ue, t.tokens), de.splice(0, de.length, ...t.extraFiles);
	for (let e of Object.keys(D)) delete D[e];
	Object.assign(D, t, {
		tokens: ue,
		extraFiles: de
	}), A(), ve++;
	for (let e of [...M]) e();
}
function Fe(e) {
	let t = -1, n;
	return () => (t !== ve && (n = e(), t = ve), n);
}
function Ie(e, t) {
	if (e.kind && ae.includes(e.kind)) return e.kind;
	if (Ce(e.id).length) return e.parent ? "frame" : "section";
	if (!t) return /photo|image|picture|cover|portrait/i.test(e.label) ? "image" : /video|film|reel/i.test(e.label) ? "video" : /scene|3d|sphere|model|globe/i.test(e.label) ? "scene" : "frame";
	let n = t.tagName.toLowerCase();
	return n === "img" || n === "picture" || t.querySelector(":scope > img, :scope > picture") ? "image" : n === "video" || t.querySelector(":scope > video") ? "video" : n === "canvas" || t.querySelector(":scope > canvas") ? "scene" : n === "svg" ? "icon" : n === "button" || n === "a" || t.getAttribute("role") === "button" ? "button" : n === "ul" || n === "ol" || n === "table" ? "list" : n === "section" || n === "header" || n === "footer" || n === "main" || n === "nav" ? "section" : (t.textContent ?? "").trim() ? "text" : "frame";
}
var N = {
	editor: "_editor_10z2u_5",
	grow: "_grow_10z2u_23",
	topbar: "_topbar_10z2u_29",
	toolbar: "_toolbar_10z2u_30",
	previewBar: "_previewBar_10z2u_31",
	brand: "_brand_10z2u_45",
	library: "_library_10z2u_69",
	slash: "_slash_10z2u_95",
	siteName: "_siteName_10z2u_100",
	left: "_left_10z2u_114",
	right: "_right_10z2u_121",
	leftHead: "_leftHead_10z2u_137",
	back: "_back_10z2u_154",
	chevron: "_chevron_10z2u_171",
	icon: "_icon_10z2u_172",
	deviceIcon: "_deviceIcon_10z2u_173",
	tabs: "_tabs_10z2u_186",
	leftScroll: "_leftScroll_10z2u_210",
	rightScroll: "_rightScroll_10z2u_211",
	tree: "_tree_10z2u_222",
	groupRow: "_groupRow_10z2u_229",
	layerRow: "_layerRow_10z2u_230",
	twist: "_twist_10z2u_280",
	layerPick: "_layerPick_10z2u_293",
	layerName: "_layerName_10z2u_320",
	off: "_off_10z2u_332",
	canvas: "_canvas_10z2u_340",
	toolbarMid: "_toolbarMid_10z2u_359",
	toolbarEnd: "_toolbarEnd_10z2u_365",
	replay: "_replay_10z2u_373",
	themes: "_themes_10z2u_391",
	chat: "_chat_10z2u_440",
	frameLabel: "_frameLabel_10z2u_443",
	frame: "_frame_10z2u_443",
	previewStart: "_previewStart_10z2u_462",
	previewBack: "_previewBack_10z2u_468",
	previewSize: "_previewSize_10z2u_485",
	preview: "_preview_10z2u_31",
	modes: "_modes_10z2u_530",
	devices: "_devices_10z2u_559",
	zoom: "_zoom_10z2u_610",
	stage: "_stage_10z2u_616",
	reload: "_reload_10z2u_634",
	layer: "_layer_10z2u_230",
	catcher: "_catcher_10z2u_672",
	pins: "_pins_10z2u_693",
	pinAt: "_pinAt_10z2u_700",
	label: "_label_10z2u_707",
	chatBox: "_chatBox_10z2u_726",
	chatPop: "_chatPop_10z2u_727",
	chatMain: "_chatMain_10z2u_752",
	chatInput: "_chatInput_10z2u_759",
	target: "_target_10z2u_788",
	send: "_send_10z2u_828",
	chatMeta: "_chatMeta_10z2u_836",
	cost: "_cost_10z2u_859",
	howLink: "_howLink_10z2u_870",
	explore: "_explore_10z2u_880",
	section: "_section_10z2u_911",
	sectionHead: "_sectionHead_10z2u_916",
	sectionNote: "_sectionNote_10z2u_931",
	tokenGroup: "_tokenGroup_10z2u_936",
	from: "_from_10z2u_941",
	pickHead: "_pickHead_10z2u_981",
	navBtn: "_navBtn_10z2u_995",
	textBox: "_textBox_10z2u_1027",
	crumbs: "_crumbs_10z2u_1043",
	crumb: "_crumb_10z2u_1043",
	layersChanged: "_layersChanged_10z2u_1072",
	fromNote: "_fromNote_10z2u_1086",
	addObject: "_addObject_10z2u_1092",
	rightTabs: "_rightTabs_10z2u_1130",
	dot: "_dot_10z2u_1141",
	changesEmpty: "_changesEmpty_10z2u_1148",
	confirmBack: "_confirmBack_10z2u_1155",
	confirm: "_confirm_10z2u_1155",
	confirmActions: "_confirmActions_10z2u_1192",
	narrowBack: "_narrowBack_10z2u_1205",
	narrow: "_narrow_10z2u_1205",
	narrowLink: "_narrowLink_10z2u_1231",
	narrowNote: "_narrowNote_10z2u_1246",
	narrowStay: "_narrowStay_10z2u_1257",
	aboutBack: "_aboutBack_10z2u_1276",
	about: "_about_10z2u_1276",
	aboutEnter: "_aboutEnter_10z2u_1",
	aboutClose: "_aboutClose_10z2u_1309",
	aboutWordmark: "_aboutWordmark_10z2u_1337",
	aboutIntro: "_aboutIntro_10z2u_1360",
	aboutTemplates: "_aboutTemplates_10z2u_1387",
	aboutTemplatesIcon: "_aboutTemplatesIcon_10z2u_1428",
	aboutTemplatesArrow: "_aboutTemplatesArrow_10z2u_1457",
	aboutSocials: "_aboutSocials_10z2u_1468",
	aboutTile: "_aboutTile_10z2u_1475",
	aboutTileTop: "_aboutTileTop_10z2u_1508",
	aboutArrow: "_aboutArrow_10z2u_1520"
}, Le = /* @__PURE__ */ e(((e) => {
	var t = Symbol.for("react.transitional.element"), n = Symbol.for("react.fragment");
	function r(e, n, r) {
		var i = null;
		if (r !== void 0 && (i = "" + r), n.key !== void 0 && (i = "" + n.key), "key" in n) for (var a in r = {}, n) a !== "key" && (r[a] = n[a]);
		else r = n;
		return n = r.ref, {
			$$typeof: t,
			type: e,
			key: i,
			ref: n === void 0 ? null : n,
			props: r
		};
	}
	e.Fragment = n, e.jsx = r, e.jsxs = r;
})), P = (/* @__PURE__ */ e(((e, t) => {
	t.exports = Le();
})))(), Re = {
	site: /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [/* @__PURE__ */ (0, P.jsx)("circle", {
		cx: "8",
		cy: "8",
		r: "5.5"
	}), /* @__PURE__ */ (0, P.jsx)("path", { d: "M2.5 8h11M8 2.5c1.8 1.6 2.6 3.4 2.6 5.5S9.8 11.9 8 13.5M8 2.5C6.2 4.1 5.4 5.9 5.4 8s.8 3.9 2.6 5.5" })] }),
	group: /* @__PURE__ */ (0, P.jsx)("path", { d: "M2.5 4.5h4l1.2 1.5h5.8v6.5h-11z" }),
	section: /* @__PURE__ */ (0, P.jsx)("path", { d: "M5 2v12M11 2v12M2 5h12M2 11h12" }),
	frame: /* @__PURE__ */ (0, P.jsx)("rect", {
		x: "2.5",
		y: "2.5",
		width: "11",
		height: "11",
		rx: "1.5",
		strokeDasharray: "2 1.6"
	}),
	text: /* @__PURE__ */ (0, P.jsx)("path", { d: "M3.5 3.5h9M8 3.5v9.5M6.3 13h3.4" }),
	image: /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [
		/* @__PURE__ */ (0, P.jsx)("rect", {
			x: "2.5",
			y: "3",
			width: "11",
			height: "10",
			rx: "1.5"
		}),
		/* @__PURE__ */ (0, P.jsx)("circle", {
			cx: "6",
			cy: "6.5",
			r: "1.1"
		}),
		/* @__PURE__ */ (0, P.jsx)("path", { d: "m2.5 11.5 3.5-3.2 2.5 2.2 2-1.6 3 2.6" })
	] }),
	video: /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [/* @__PURE__ */ (0, P.jsx)("rect", {
		x: "2.5",
		y: "3",
		width: "11",
		height: "10",
		rx: "1.5"
	}), /* @__PURE__ */ (0, P.jsx)("path", { d: "M6.8 5.8v4.4L10.3 8z" })] }),
	button: /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [/* @__PURE__ */ (0, P.jsx)("rect", {
		x: "1.8",
		y: "4.8",
		width: "12.4",
		height: "6.4",
		rx: "3.2"
	}), /* @__PURE__ */ (0, P.jsx)("path", { d: "M5.5 8h5" })] }),
	icon: /* @__PURE__ */ (0, P.jsx)("path", { d: "m8 2.5 1.6 3.6 3.9.4-2.9 2.6.8 3.9L8 11l-3.4 2 .8-3.9-2.9-2.6 3.9-.4z" }),
	scene: /* @__PURE__ */ (0, P.jsx)("path", { d: "m8 2 5.5 3v6L8 14l-5.5-3V5zM2.5 5 8 8l5.5-3M8 8v6" }),
	list: /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [
		/* @__PURE__ */ (0, P.jsx)("path", { d: "M6 4.5h7.5M6 8h7.5M6 11.5h7.5" }),
		/* @__PURE__ */ (0, P.jsx)("circle", {
			cx: "3.3",
			cy: "4.5",
			r: ".6"
		}),
		/* @__PURE__ */ (0, P.jsx)("circle", {
			cx: "3.3",
			cy: "8",
			r: ".6"
		}),
		/* @__PURE__ */ (0, P.jsx)("circle", {
			cx: "3.3",
			cy: "11.5",
			r: ".6"
		})
	] })
}, ze = {
	site: "Whole site",
	group: "Group",
	section: "Section",
	frame: "Frame",
	text: "Text",
	image: "Image",
	video: "Video",
	button: "Button",
	icon: "Icon",
	scene: "3D or canvas scene",
	list: "List"
};
function Be({ kind: e }) {
	return /* @__PURE__ */ (0, P.jsxs)("svg", {
		className: N.icon,
		viewBox: "0 0 16 16",
		role: "img",
		"aria-label": ze[e],
		"data-kind": e,
		children: [/* @__PURE__ */ (0, P.jsx)("title", { children: ze[e] }), Re[e]]
	});
}
// runtime/panel-src/inspector/site.ts
var Ve = "/__inspector/editor", He = () => location.pathname === Ve;
function Ue() {
	if (window === window.parent) return !1;
	try {
		return window.parent.location.pathname === Ve;
	} catch {
		return !1;
	}
}
var We = {
	win: window,
	doc: document,
	reload: () => location.reload()
}, Ge = We;
function Ke(e) {
	let t = e?.contentWindow, n = e?.contentDocument;
	Ge = t && n ? {
		win: t,
		doc: n,
		reload: () => t.location.reload()
	} : We;
}
var qe = () => Ge.reload(), Je = null;
function Ye() {
	Je = Ge.win.scrollY, Ge.reload();
}
var Xe = () => {
	let e = Je;
	return Je = null, e;
}, Ze = (e) => e.state === "queued" || e.state === "running", Qe = (e) => !!e.entry && !!e.files?.length && !e.undone;
function $e(e) {
	let t = /* @__PURE__ */ new Map();
	for (let n of [...e].reverse()) t.set(n.thread ?? n.id, [...t.get(n.thread ?? n.id) ?? [], n]);
	return [...t.entries()].map(([e, t]) => {
		t.sort((e, t) => (e.try ?? 1) - (t.try ?? 1));
		let n = t[t.length - 1], r = t.some(Qe), i = t.some(Ze), a = t.some((e) => e.undone) && !r, o = t.some((e) => e.kept);
		return {
			id: e,
			tries: t,
			latest: n,
			changed: r,
			active: i,
			undone: a,
			kept: o,
			resolved: !i && (a || r && o)
		};
	}).sort((e, t) => Math.max(t.latest.queuedAt, t.latest.finished ?? 0) - Math.max(e.latest.queuedAt, e.latest.finished ?? 0));
}
var et = 700, F = Date.now(), tt = () => {
	F = Date.now(), nt.clear();
}, nt = /* @__PURE__ */ new Set(), rt = 4e3, it = 0, at = () => {
	it = Date.now();
}, ot = 6e3, st = 0, ct = 0, lt = async (e, t) => {
	let n = await (await p(e, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(t)
	})).json();
	if (!n.ok) throw Error(n.error ?? "The dev server said no");
};
function ut(e) {
	let [t, n] = (0, E.useState)([]), [r, i] = (0, E.useState)(3), [a, o] = (0, E.useState)(null), [s, c] = (0, E.useState)(null), [l, u] = (0, E.useState)(0), [d, f] = (0, E.useState)({}), m = (0, E.useRef)(/* @__PURE__ */ new Map()), h = (0, E.useRef)(e);
	h.current = e;
	let g = (0, E.useCallback)(async () => {
		try {
			let e = await (await p("/__inspector/jobs")).json(), t = [];
			for (let n of e.jobs) {
				let e = m.current.get(n.id);
				e && Ze({ state: e }) && !Ze(n) && (h.current(n), n.state === "done" && t.push(...n.files ?? [])), m.current.set(n.id, n.state);
			}
			n(e.jobs), e.max && i(e.max), o(e.comparing ?? null);
			for (let e of t) nt.add(e);
			(t.length || e.jobs.some(Ze)) && (st = Date.now());
			let r = e.stale && e.stale.at > F && e.stale.at !== ct ? e.stale : null, a = !!r && r.at >= it && r.at - it < ot && st < it;
			if (r && a) it = 0, ct = r.at, c(null), Ye();
			else {
				let e = r ? {
					files: r.files,
					asked: r.files.some((e) => nt.has(e))
				} : null;
				c((t) => JSON.stringify(t) === JSON.stringify(e) ? t : e);
			}
			u(e.mapAt ?? 0), f((t) => JSON.stringify(t) === JSON.stringify(e.settingFlags ?? {}) ? t : e.settingFlags ?? {});
		} catch {}
	}, []);
	(0, E.useEffect)(() => {
		let e = () => void g();
		return window.addEventListener("design-inspector:stale", e), () => window.removeEventListener("design-inspector:stale", e);
	}, [g]);
	let _ = t.some(Ze);
	(0, E.useEffect)(() => {
		g();
		let e = setInterval(() => void g(), _ ? et : rt);
		return () => clearInterval(e);
	}, [_, g]);
	let v = (0, E.useCallback)((e) => async (t) => {
		await lt(e, { id: t }), await g();
	}, [g]), y = (0, E.useCallback)(async (e, t) => {
		await lt(e, t), await g();
	}, [g]), b = (0, E.useCallback)(async (e, t) => {
		at(), await y(e, t);
	}, [y]);
	return {
		settingFlags: d,
		jobs: t,
		threads: $e(t),
		max: r,
		comparing: a,
		stale: s,
		mapAt: l,
		refresh: g,
		stop: v("/__inspector/stop"),
		dismiss: (e) => y("/__inspector/dismiss", { id: e }),
		keep: (e) => y("/__inspector/keep", { thread: e }),
		undo: (e) => b("/__inspector/undo", { thread: e }),
		bringBack: (e) => b("/__inspector/bring-back", { thread: e }),
		compare: (e, t) => b("/__inspector/compare", t === "after" ? {
			thread: e,
			side: "after"
		} : {
			thread: e,
			upTo: t
		}),
		choose: (e, t) => b("/__inspector/choose", {
			thread: e,
			upTo: t
		}),
		refine: (e, t) => y("/__inspector/run", {
			thread: e,
			request: t,
			mode: "part",
			part: "",
			prompt: "",
			model: "",
			effort: ""
		})
	};
}
var dt = [
	{
		phase: "preparing",
		label: "Picking context"
	},
	{
		phase: "thinking",
		label: "Thinking"
	},
	{
		phase: "writing",
		label: "Writing"
	},
	{
		phase: "applying",
		label: "Applying"
	},
	{
		phase: "checking",
		label: "Checking"
	}
], ft = (e) => {
	if (e.state === "queued") return "Waiting its turn";
	if (e.mode === "project") return e.log.at(-1)?.slice(0, 70) ?? "Working";
	let t = e.progress.phase;
	return t === "fixing" ? "Fixing a check error" : t === "writing" && e.progress.written > 0 ? `Writing · ~${vt(Math.round(e.progress.written / 3.6))} tokens` : dt.find((e) => e.phase === t)?.label ?? "Working";
};
function pt(e, t) {
	let n = e.progress;
	if (e.state !== "running" || !e.eta) return null;
	if (n.phase === "writing" && n.writingSince && n.written > 300) {
		let r = n.written / Math.max(1, (t - n.writingSince) / 1e3);
		return Math.max(2, (e.eta.outputChars * 1.1 - n.written) / r);
	}
	return e.eta.seconds - (t - e.started) / 1e3;
}
function mt(e, t) {
	if (e.state === "done" || e.state === "error") return 1;
	if (e.state === "queued") return 0;
	let n = (t - e.started) / 1e3, r = pt(e, t);
	return r === null ? Math.min(.9, n / 60) : Math.min(.94, Math.max(.04, n / Math.max(1, n + Math.max(0, r))));
}
var ht = (e, t) => {
	let n = pt(e, t);
	return n === null ? "" : n <= 0 ? "longer than usual" : `about ${n < 60 ? `${Math.max(1, Math.round(n / 5) * 5)} s` : `${Math.round(n / 60)} min`} left`;
}, gt = (e) => {
	let t = Math.max(0, Math.round(e / 1e3));
	return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}, _t = (e) => e.toFixed(1).replace(/\.0$/, ""), vt = (e) => e >= 1e9 ? `${_t(e / 1e9)}B` : e >= 1e6 ? `${_t(e / 1e6)}M` : e >= 1e3 ? `${_t(e / 1e3)}k` : String(e);
function I(e) {
	let [t, n] = (0, E.useState)(Date.now());
	return (0, E.useEffect)(() => {
		if (!e) return;
		let t = setInterval(() => n(Date.now()), 250);
		return () => clearInterval(t);
	}, [e]), t;
}
var L = {
	root: "_root_z2cqr_18",
	toggle: "_toggle_z2cqr_19",
	head: "_head_z2cqr_154",
	overlay: "_overlay_z2cqr_163",
	icon: "_icon_z2cqr_243",
	close: "_close_z2cqr_251",
	pulseLayer: "_pulseLayer_z2cqr_256",
	pulse: "_pulse_z2cqr_256",
	"inspector-pulse": "_inspector-pulse_z2cqr_1",
	mark: "_mark_z2cqr_283",
	steps: "_steps_z2cqr_326",
	step: "_step_z2cqr_326",
	"inspector-step": "_inspector-step_z2cqr_1",
	eta: "_eta_z2cqr_357",
	context: "_context_z2cqr_363",
	contextHead: "_contextHead_z2cqr_373",
	contextItem: "_contextItem_z2cqr_380",
	moreLog: "_moreLog_z2cqr_400",
	box: "_box_z2cqr_418",
	tag: "_tag_z2cqr_434",
	panel: "_panel_z2cqr_473",
	foot: "_foot_z2cqr_491",
	hint: "_hint_z2cqr_508",
	count: "_count_z2cqr_509",
	scroll: "_scroll_z2cqr_514",
	ghost: "_ghost_z2cqr_520",
	primary: "_primary_z2cqr_521",
	layers: "_layers_z2cqr_560",
	group: "_group_z2cqr_568",
	details: "_details_z2cqr_569",
	layer: "_layer_z2cqr_560",
	layerName: "_layerName_z2cqr_602",
	chip: "_chip_z2cqr_614",
	off: "_off_z2cqr_640",
	empty: "_empty_z2cqr_646",
	note: "_note_z2cqr_661",
	quote: "_quote_z2cqr_668",
	field: "_field_z2cqr_685",
	list: "_list_z2cqr_696",
	raw: "_raw_z2cqr_703",
	number: "_number_z2cqr_704",
	token: "_token_z2cqr_725",
	tokenHead: "_tokenHead_z2cqr_735",
	swatch: "_swatch_z2cqr_747",
	invalid: "_invalid_z2cqr_766",
	link: "_link_z2cqr_772",
	role: "_role_z2cqr_779",
	color: "_color_z2cqr_785",
	phone: "_phone_z2cqr_864",
	more: "_more_z2cqr_400",
	moreBox: "_moreBox_z2cqr_883",
	files: "_files_z2cqr_889",
	regen: "_regen_z2cqr_898",
	picks: "_picks_z2cqr_926",
	pick: "_pick_z2cqr_926",
	runRow: "_runRow_z2cqr_956",
	estimate: "_estimate_z2cqr_968",
	error: "_error_z2cqr_981",
	result: "_result_z2cqr_989",
	connected: "_connected_z2cqr_1001",
	setup: "_setup_z2cqr_1017",
	command: "_command_z2cqr_1053",
	scope: "_scope_z2cqr_1079",
	hintBox: "_hintBox_z2cqr_1110",
	replying: "_replying_z2cqr_1115",
	jobHead: "_jobHead_z2cqr_1122",
	log: "_log_z2cqr_1127",
	actions: "_actions_z2cqr_1147",
	needs: "_needs_z2cqr_1163",
	progress: "_progress_z2cqr_1177",
	advice: "_advice_z2cqr_1191",
	pages: "_pages_z2cqr_1200",
	pageRow: "_pageRow_z2cqr_1208",
	pin: "_pin_z2cqr_1247",
	assetSearch: "_assetSearch_z2cqr_1283",
	assets: "_assets_z2cqr_1295",
	asset: "_asset_z2cqr_1283",
	history: "_history_z2cqr_1363",
	version: "_version_z2cqr_1371",
	versionHead: "_versionHead_z2cqr_1385",
	versionLabel: "_versionLabel_z2cqr_1396",
	versionActions: "_versionActions_z2cqr_1410",
	versionBody: "_versionBody_z2cqr_1424",
	badge: "_badge_z2cqr_1429",
	now: "_now_z2cqr_1452",
	cards: "_cards_z2cqr_1469",
	card: "_card_z2cqr_1469",
	cardsFoot: "_cardsFoot_z2cqr_1512",
	"inspector-card-in": "_inspector-card-in_z2cqr_1",
	cardTop: "_cardTop_z2cqr_1556",
	cardWhat: "_cardWhat_z2cqr_1562",
	cardMeta: "_cardMeta_z2cqr_1567",
	cardKind: "_cardKind_z2cqr_1575",
	cardPart: "_cardPart_z2cqr_1597",
	cardAsk: "_cardAsk_z2cqr_1616",
	cardX: "_cardX_z2cqr_1625",
	bar: "_bar_z2cqr_1643",
	"inspector-wait": "_inspector-wait_z2cqr_1",
	cardStep: "_cardStep_z2cqr_1676",
	cardText: "_cardText_z2cqr_1685",
	cardError: "_cardError_z2cqr_1694",
	cardActions: "_cardActions_z2cqr_1700",
	cardCost: "_cardCost_z2cqr_1708",
	glyph: "_glyph_z2cqr_1759",
	glyphTrack: "_glyphTrack_z2cqr_1792",
	glyphSpin: "_glyphSpin_z2cqr_1793",
	"inspector-spin": "_inspector-spin_z2cqr_1",
	glyphCore: "_glyphCore_z2cqr_1810",
	"inspector-core": "_inspector-core_z2cqr_1",
	glyphDot: "_glyphDot_z2cqr_1816",
	"inspector-dot": "_inspector-dot_z2cqr_1",
	glyphCheck: "_glyphCheck_z2cqr_1821",
	glyphMark: "_glyphMark_z2cqr_1822",
	"inspector-draw": "_inspector-draw_z2cqr_1",
	cardCompare: "_cardCompare_z2cqr_1900",
	segment: "_segment_z2cqr_1908",
	cardIcon: "_cardIcon_z2cqr_1935",
	cardMore: "_cardMore_z2cqr_1957",
	cardKeep: "_cardKeep_z2cqr_1996",
	reload: "_reload_z2cqr_2017",
	reloadEnter: "_reloadEnter_z2cqr_1",
	reloadWave: "_reloadWave_z2cqr_1",
	behind: "_behind_z2cqr_2106",
	behindHead: "_behindHead_z2cqr_2114",
	behindMore: "_behindMore_z2cqr_2129",
	behindDot: "_behindDot_z2cqr_2134",
	behindCopy: "_behindCopy_z2cqr_2162",
	stepper: "_stepper_z2cqr_2179",
	useThis: "_useThis_z2cqr_2218",
	tokenName: "_tokenName_z2cqr_2237",
	easing: "_easing_z2cqr_2254",
	bezier: "_bezier_z2cqr_2261",
	graph: "_graph_z2cqr_2280",
	graphBox: "_graphBox_z2cqr_2288",
	graphDiagonal: "_graphDiagonal_z2cqr_2293",
	graphArm: "_graphArm_z2cqr_2298",
	graphCurve: "_graphCurve_z2cqr_2303",
	graphHandle: "_graphHandle_z2cqr_2310",
	easingPreview: "_easingPreview_z2cqr_2328",
	easingMove: "_easingMove_z2cqr_1",
	font: "_font_z2cqr_2355",
	fontButton: "_fontButton_z2cqr_2360",
	fontPop: "_fontPop_z2cqr_2382",
	fontKinds: "_fontKinds_z2cqr_2405",
	fontList: "_fontList_z2cqr_2425",
	fontEmpty: "_fontEmpty_z2cqr_2457",
	fontSource: "_fontSource_z2cqr_2458",
	linkRow: "_linkRow_z2cqr_2470",
	media: "_media_z2cqr_2488",
	danger: "_danger_z2cqr_2515",
	play: "_play_z2cqr_2520",
	withPlay: "_withPlay_z2cqr_2546",
	easingRow: "_easingRow_z2cqr_2552",
	deleteLayer: "_deleteLayer_z2cqr_2562",
	totals: "_totals_z2cqr_2568",
	totalsButton: "_totalsButton_z2cqr_2574",
	totalsTop: "_totalsTop_z2cqr_2595",
	totalsLabel: "_totalsLabel_z2cqr_2601",
	totalsBar: "_totalsBar_z2cqr_2619",
	totalsShine: "_totalsShine_z2cqr_1",
	totalsGain: "_totalsGain_z2cqr_2657",
	totalsPop: "_totalsPop_z2cqr_2786",
	totalsSparks: "_totalsSparks_z2cqr_2704",
	totalsSpark: "_totalsSpark_z2cqr_2704",
	totalsToast: "_totalsToast_z2cqr_2737",
	totalsTiers: "_totalsTiers_z2cqr_2818",
	totalsNote: "_totalsNote_z2cqr_2834",
	totalsSite: "_totalsSite_z2cqr_2863"
}, yt = 3e4, bt = [
	{
		at: 0,
		name: "Getting started",
		from: "#555160",
		to: "#555160",
		glow: "transparent"
	},
	{
		at: 1e5,
		name: "100k saved",
		from: "#17784E",
		to: "#17784E",
		glow: "rgba(23, 120, 78, 0.28)"
	},
	{
		at: 1e6,
		name: "1M saved",
		from: "#365DAC",
		to: "#365DAC",
		glow: "rgba(54, 93, 172, 0.28)"
	},
	{
		at: 1e7,
		name: "10M saved",
		from: "#6B3FE0",
		to: "#6B3FE0",
		glow: "rgba(107, 63, 224, 0.3)",
		shine: !0
	},
	{
		at: 5e7,
		name: "50M saved",
		from: "#975015",
		to: "#975015",
		glow: "rgba(151, 80, 21, 0.3)",
		shine: !0
	},
	{
		at: 1e8,
		name: "100M saved",
		from: "#A33577",
		to: "#A33577",
		glow: "rgba(163, 53, 119, 0.3)",
		shine: !0
	},
	{
		at: 5e8,
		name: "500M saved",
		from: "#493178",
		to: "#493178",
		glow: "rgba(73, 49, 120, 0.32)",
		shine: !0
	},
	{
		at: 1e9,
		name: "1B saved",
		from: "#16141C",
		to: "#16141C",
		glow: "rgba(255, 255, 255, 0.14)",
		shine: !0
	}
], xt = (e) => bt.reduce((t, n, r) => e >= n.at ? r : t, 0), St = "design-inspector:milestones", R = 900, z = () => typeof matchMedia == "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
function Ct() {
	try {
		return Number(localStorage.getItem(St) ?? "-1");
	} catch {
		return -1;
	}
}
function wt(e) {
	try {
		localStorage.setItem(St, String(e));
	} catch {}
}
function Tt(e, t) {
	let [n, r] = (0, E.useState)(e), i = (0, E.useRef)(e);
	return (0, E.useEffect)(() => {
		let n = i.current;
		if (e === n || !t || z()) return i.current = e, r(e);
		let a = performance.now(), o = 0, s = (t) => {
			let c = Math.min(1, (t - a) / R), l = 1 - (1 - c) ** 3;
			r(Math.round(n + (e - n) * l)), c < 1 ? o = requestAnimationFrame(s) : i.current = e;
		};
		return o = requestAnimationFrame(s), () => {
			cancelAnimationFrame(o), i.current = e;
		};
	}, [e, t]), n;
}
function Et({ finished: e }) {
	let [t, n] = (0, E.useState)(null), [r, i] = (0, E.useState)(!1), [a, o] = (0, E.useState)(null), [s, c] = (0, E.useState)(null), l = (0, E.useRef)(null), u = (0, E.useRef)(!1);
	(0, E.useEffect)(() => {
		let e = !0, t = () => p("/__inspector/totals").then((e) => e.json()).then((t) => e && t.ok && n(t)).catch(() => void 0);
		t();
		let r = setInterval(t, yt);
		return window.addEventListener("focus", t), () => {
			e = !1, clearInterval(r), window.removeEventListener("focus", t);
		};
	}, [e]);
	let d = t?.all.saved ?? 0;
	(0, E.useEffect)(() => {
		if (!t) return;
		let e = l.current;
		l.current = d;
		let n = xt(d);
		e === null ? Ct() < 0 && wt(n) : (d > e && o({
			n: d - e,
			key: Date.now()
		}), n > Ct() && n > 0 && (wt(n), c(n)));
	}, [d, t]), (0, E.useEffect)(() => {
		if (s === null) return;
		let e = setTimeout(() => c(null), 4200);
		return () => clearTimeout(e);
	}, [s]);
	let f = Tt(d, u.current);
	if ((0, E.useEffect)(() => {
		t && (u.current = !0);
	}, [t]), !t) return null;
	let m = xt(d), h = bt[m], g = bt[m + 1], _ = g ? Math.min(1, (d - h.at) / (g.at - h.at)) : 1, v = new Date(t.since).toLocaleDateString(void 0, {
		day: "numeric",
		month: "short",
		year: "numeric"
	}), y = (/* @__PURE__ */ new Date(`${t.backtest.date}T12:00:00`)).toLocaleDateString(void 0, {
		day: "numeric",
		month: "short",
		year: "numeric"
	}), b = {
		"--tier-from": h.from,
		"--tier-to": h.to,
		"--tier-glow": h.glow
	};
	return /* @__PURE__ */ (0, P.jsxs)("div", {
		className: L.totals,
		style: b,
		children: [
			/* @__PURE__ */ (0, P.jsxs)("button", {
				type: "button",
				className: L.totalsButton,
				"data-tier": m,
				"data-shine": !!h.shine,
				"data-party": s !== null,
				onClick: () => i((e) => !e),
				"aria-expanded": r,
				title: `Tokens saved by uberdesigner · ${g ? `${vt(g.at - d)} to ${g.name}` : h.name}`,
				children: [
					/* @__PURE__ */ (0, P.jsxs)("span", {
						className: L.totalsTop,
						children: [/* @__PURE__ */ (0, P.jsx)("span", {
							className: L.totalsLabel,
							children: "Tokens Saved by uberdesigner"
						}), /* @__PURE__ */ (0, P.jsx)("strong", { children: vt(f) })]
					}),
					/* @__PURE__ */ (0, P.jsx)("span", {
						className: L.totalsBar,
						"aria-hidden": "true",
						children: /* @__PURE__ */ (0, P.jsx)("i", { style: { width: `${Math.round(_ * 100)}%` } })
					}),
					a && /* @__PURE__ */ (0, P.jsxs)("span", {
						className: L.totalsGain,
						onAnimationEnd: () => o(null),
						"aria-hidden": "true",
						children: ["+", vt(a.n)]
					}, a.key),
					s !== null && /* @__PURE__ */ (0, P.jsx)("span", {
						className: L.totalsSparks,
						"aria-hidden": "true",
						children: Array.from({ length: 14 }, (e, t) => /* @__PURE__ */ (0, P.jsx)("i", { style: {
							"--a": `${t / 14 * 360}deg`,
							"--d": `${38 + t % 3 * 14}px`
						} }, t))
					})
				]
			}),
			s !== null && /* @__PURE__ */ (0, P.jsxs)("p", {
				className: L.totalsToast,
				role: "status",
				children: [bt[s].name, "! Tokens saved by uberdesigner."]
			}),
			r && /* @__PURE__ */ (0, P.jsxs)("div", {
				className: L.totalsPop,
				role: "dialog",
				"aria-label": "Tokens saved",
				children: [
					/* @__PURE__ */ (0, P.jsxs)("dl", { children: [
						/* @__PURE__ */ (0, P.jsx)("dt", { children: "Tokens saved" }),
						/* @__PURE__ */ (0, P.jsx)("dd", { children: t.all.saved.toLocaleString() }),
						/* @__PURE__ */ (0, P.jsx)("dt", { children: "Tokens used" }),
						/* @__PURE__ */ (0, P.jsx)("dd", { children: t.all.used.toLocaleString() }),
						/* @__PURE__ */ (0, P.jsx)("dt", { children: "Changes" }),
						/* @__PURE__ */ (0, P.jsx)("dd", { children: t.all.changes.toLocaleString() })
					] }),
					/* @__PURE__ */ (0, P.jsx)("ol", {
						className: L.totalsTiers,
						children: bt.slice(1).map((e, t) => /* @__PURE__ */ (0, P.jsxs)("li", {
							"data-reached": d >= e.at,
							style: {
								"--tier-from": e.from,
								"--tier-to": e.to
							},
							children: [
								/* @__PURE__ */ (0, P.jsx)("i", {}),
								e.name,
								t + 1 === m && /* @__PURE__ */ (0, P.jsx)("small", { children: "now" })
							]
						}, e.at))
					}),
					t.site && /* @__PURE__ */ (0, P.jsxs)("p", {
						className: L.totalsSite,
						children: [
							"This site: ",
							vt(t.site.saved),
							" saved, ",
							vt(t.site.used),
							" used, ",
							t.site.changes,
							" change",
							t.site.changes === 1 ? "" : "s"
						]
					}),
					/* @__PURE__ */ (0, P.jsxs)("p", {
						className: L.totalsNote,
						children: [
							"Across every site and chat on this computer since ",
							v,
							"."
						]
					}),
					/* @__PURE__ */ (0, P.jsxs)("p", {
						className: L.totalsNote,
						children: [
							/* @__PURE__ */ (0, P.jsx)("strong", { children: "How it's estimated." }),
							" Savings are our own estimate, from a backtest on our test sites (",
							y,
							"): the same ",
							t.backtest.cases,
							" everyday changes, made with plain Claude Code, used a median of ",
							vt(t.backtest.claudeCode),
							" tokens each; through uberdesigner, ",
							vt(t.backtest.inspector),
							". Each change you make here counts the difference (typed text, links and sliders use no tokens, so they count all of it). Tokens are weighted the way usage is priced: a token read again from cache counts a tenth, a token written to cache 1.25, output 5. Claude Code's plans don't publish how they count, so this is the closest fair measure. Nothing runs on your computer to measure it.",
							" ",
							/* @__PURE__ */ (0, P.jsx)("a", {
								href: "https://github.com/bogdan239/uberdesigner-studio/blob/main/docs/methodology.md",
								target: "_blank",
								rel: "noopener noreferrer",
								children: "The method in full, on GitHub"
							}),
							"."
						]
					}),
					/* @__PURE__ */ (0, P.jsxs)("p", {
						className: L.totalsNote,
						children: [
							/* @__PURE__ */ (0, P.jsx)("strong", { children: "uberdesigner studio." }),
							" © 2026 Advanced Design Technologies Ltd. Free software under the GNU Affero General Public License, version 3, with no warranty. The licence and the notice are in this site's folder, in",
							" ",
							/* @__PURE__ */ (0, P.jsx)("code", { children: ".inspector/tool/" }),
							"."
						]
					})
				]
			})
		]
	});
}
// runtime/server/values.ts
var Dt = new Set("aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent currentcolor".split(" ")), Ot = /* @__PURE__ */ new Set([
	"inherit",
	"initial",
	"unset",
	"revert",
	"revert-layer"
]), kt = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|var|env)\(/i;
function At(e) {
	let t = [], n = {
		")": "(",
		"]": "["
	};
	for (let r = 0; r < e.length; r++) {
		let i = e[r];
		if (i === "\\") {
			if (r === e.length - 1) return "it ends with a backslash";
			r++;
		} else if (i === "\"" || i === "'") {
			let t = (() => {
				for (let t = r + 1; t < e.length; t++) if (e[t] === "\\") t++;
				else if (e[t] === i) return t;
				return -1;
			})();
			if (t < 0) return `a quote (${i}) isn't closed`;
			r = t;
		} else if (i === "(" || i === "[") t.push(i);
		else if ((i === ")" || i === "]") && t.pop() !== n[i]) return `there's a "${i}" with nothing to close`;
	}
	return t.length ? `a "${t[t.length - 1]}" isn't closed` : null;
}
function jt(e) {
	let t = e.trim();
	if (!t) return "it's empty";
	if (/[\r\n]/.test(t)) return "it has a line break";
	let n = t.match(/[;{}<>]|\/\*|\*\//);
	return n ? `it has "${n[0]}", which would end the value early` : At(t);
}
function Mt(e) {
	let t = e.trim().replace(/\s*!important$/i, "");
	return /^#[0-9a-f]+$/i.test(t) ? [
		3,
		4,
		6,
		8
	].includes(t.length - 1) : kt.test(t) ? t.endsWith(")") && jt(t) === null : Dt.has(t.toLowerCase()) || Ot.has(t.toLowerCase());
}
// runtime/server/address.ts
var Nt = "data-dm", Pt = (e) => e && typeof e == "object" ? e : {}, Ft = (e) => e.trim().replace(/\s+/g, " ").replace(/=\s*'([^'"]*)'/g, "=\"$1\""), It = (e) => (e.targets ?? []).map((e) => Pt(e).selector).filter((e) => typeof e == "string" && !!e.trim()).map(Ft), Lt = (e) => (e.targets ?? []).map(Pt).filter((e) => typeof e.selector != "string" && typeof e.file == "string"), Rt = (e) => `[${Nt}="${e}"]`, zt = (e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function Bt(e) {
	let t = It(e);
	return t.length ? [...Lt(e).length ? [Rt(e.id)] : [], ...t].join(", ") : Rt(e.id);
}
function Vt(e) {
	let t = Ft(e).split(/\s*,\s*/).map((e) => zt(e).replace(/"/g, "[\"']").replace(/ /g, "\\s+")).join("\\s*,\\s*");
	return RegExp(`(?<=(?:^|[{};])\\s*)${t}\\s*\\{[^}]*\\}`, "g");
}
// runtime/panel-src/inspector/resolve.ts
var Ht = `[${Nt}]`, Ut = Fe(() => O.map((e) => ({
	id: e.id,
	selector: It(e).join(", ")
})).filter((e) => e.selector)), Wt = /* @__PURE__ */ new WeakMap();
function B(e) {
	let t = Wt.get(e);
	if (t) return t;
	let n = {
		observer: new ((e.defaultView?.MutationObserver) ?? MutationObserver)(() => void (n.stale = !0, n.changes++)),
		stale: !0,
		changes: 0,
		rev: De(),
		lists: /* @__PURE__ */ new Map(),
		marked: /* @__PURE__ */ new Map(),
		problems: /* @__PURE__ */ new Map()
	};
	return n.observer.observe(e.documentElement, {
		subtree: !0,
		childList: !0,
		attributes: !0,
		attributeFilter: [
			Nt,
			"class",
			"id"
		]
	}), Wt.set(e, n), n;
}
function Gt(e, t) {
	if (t.stale = !1, t.lists.clear(), !Ut().length && !t.marked.size) return;
	t.problems.clear();
	let n = /* @__PURE__ */ new Map();
	for (let r of Ut()) {
		let i;
		try {
			i = [...e.querySelectorAll(r.selector)];
		} catch {
			t.problems.set(r.id, `its address (${r.selector}) isn't a selector the browser can read`);
			continue;
		}
		for (let e of i) {
			let i = e.getAttribute(Nt), a = i && i !== r.id && t.marked.get(e) !== i ? i : n.has(e) && n.get(e) !== r.id ? n.get(e) : null;
			a ? t.problems.set(r.id, `its address (${r.selector}) lands on an element that is already ${j(a)?.label ?? a}: an element carries one layer`) : n.set(e, r.id);
		}
	}
	for (let [e, r] of t.marked) {
		if (n.get(e) === r) continue;
		let i = j(r);
		!(i && !It(i).length && Lt(i).length) && e.getAttribute("data-dm") === r && e.removeAttribute(Nt), t.marked.delete(e);
	}
	for (let [e, r] of n) e.getAttribute("data-dm") !== r && e.setAttribute(Nt, r), t.marked.set(e, r);
	t.observer.takeRecords();
}
function Kt(e) {
	let t = B(e);
	return t.observer.takeRecords().length && (t.stale = !0, t.changes++), t.rev !== De() && (t.rev = De(), t.stale = !0), t.stale && Gt(e, t), t;
}
function qt(e) {
	e.documentElement && Kt(e);
}
var Jt = (e) => Kt(e).changes;
function V(e, t) {
	if (!e?.documentElement) return [];
	let n = Kt(e), r = n.lists.get(t);
	return r || (r = [...e.querySelectorAll(Rt(t))], n.lists.set(t, r)), r;
}
var Yt = (e, t) => V(e, t)[0] ?? null, Xt = (e, t) => V(e, t).length > 0;
function Zt(e) {
	return Kt(e), [...e.querySelectorAll(Ht)];
}
function Qt(e) {
	return e ? (Kt(e.ownerDocument), e.closest(Ht)) : null;
}
var $t = (e) => e.hasAttribute(Nt);
function en(e) {
	return Kt(e.ownerDocument), [...e.querySelectorAll(Ht)];
}
var tn = (e) => e?.getAttribute("data-dm") ?? null, nn = (e, t) => t === e || !$t(t) && Qt(t) === e, rn = (e, t) => e?.documentElement ? Kt(e).problems.get(t) ?? null : null, an = /* @__PURE__ */ "display.visibility.opacity.position.top.left.z-index.width.height.margin-top.margin-right.margin-bottom.margin-left.padding-top.padding-right.padding-bottom.padding-left.row-gap.column-gap.justify-content.align-items.flex-direction.grid-template-columns.color.background-color.background-image.border-top-color.border-top-width.border-top-style.border-top-left-radius.box-shadow.outline-color.fill.stroke.filter.backdrop-filter.transform.font-family.font-size.font-weight.font-style.line-height.letter-spacing.text-transform.text-align.text-decoration-line.transition-duration.transition-delay.transition-timing-function.animation-name.animation-duration.animation-delay".split("."), on = 40;
function sn(e, t) {
	let n = [];
	for (let r of V(e, t)) {
		n.push(r);
		for (let e of r.querySelectorAll("*")) {
			if (n.length >= on) return n;
			nn(r, e) && n.push(e);
		}
	}
	return n.slice(0, on);
}
function cn(e, t) {
	let n = e?.defaultView, r = V(e, t);
	if (!e || !n || !r.length) return null;
	let i = sn(e, t);
	return {
		elements: r.reduce((e, t) => e + 1 + t.querySelectorAll("*").length, 0),
		text: r.map((e) => e.innerText ?? e.textContent ?? "").join("\n").replace(/\s+/g, " ").trim().slice(0, 4e3),
		media: i.map((e) => e.getAttribute("src") ?? e.getAttribute("href") ?? "").join("|"),
		styles: i.map((e) => {
			let t = n.getComputedStyle(e);
			return an.map((e) => t.getPropertyValue(e)).join(";");
		})
	};
}
var ln = (e, t) => e.elements === t.elements && e.text === t.text && e.media === t.media && e.styles.length === t.styles.length && e.styles.every((e, n) => e === t.styles[n]), un = () => null, dn = /* @__PURE__ */ new Map(), fn = /* @__PURE__ */ new Map(), pn = /* @__PURE__ */ new Set(), mn = () => un()?.contentDocument ?? null;
function hn(e) {
	dn.set(e, {
		look: cn(un()?.contentDocument, e),
		at: Date.now()
	});
}
var gn = 1500, _n = "(hover, motion and anything drawn in a canvas aren't checked)";
function vn(e, t, n) {
	let r = j(e.partId), i = fn.get(e.id);
	if (!r || i === void 0) return "";
	let a = [], o = (e.added ?? []).filter((e) => !Xt(t, e));
	o.length && a.push(`The new layer${o.length > 1 ? "s" : ""} ${o.join(", ")} ${o.length > 1 ? "aren't" : "isn't"} on the page now: ${o.length > 1 ? "they" : "it"} may only show in some state, or the change put ${o.length > 1 ? "them" : "it"} where the page doesn't draw.`);
	let s = cn(t, r.id), c = V(t, r.id)[0] ?? null, l = !!c && (Ie(r, c) === "scene" || c.tagName === "CANVAS" || !!c.querySelector("canvas")), u = (e.added ?? []).some((e) => Xt(t, e));
	return i && s && !l && !u && ln(i, s) && a.push(`Nothing on ${r.label} looks different at ${n} px ${_n}.`), a.join(" ");
}
function yn(e, t) {
	un = e;
	let n = (0, E.useRef)(t);
	n.current = t, (0, E.useEffect)(() => {
		let e = window.setInterval(() => {
			let { jobs: e, stale: t, comparing: r, width: i, loadedAt: a, onReported: o } = n.current, s = un()?.contentDocument;
			if (s?.body) for (let n of e) {
				if (n.mode !== "part" || !n.partId || n.direct) continue;
				if (!fn.has(n.id)) {
					let e = dn.get(n.partId);
					e && n.queuedAt - e.at < 15e3 && e.at - n.queuedAt < 2e3 ? (fn.set(n.id, e.look), dn.delete(n.partId)) : fn.set(n.id, Ze(n) ? cn(s, n.partId) : void 0);
				}
				if (n.state !== "done" || !n.files?.length || n.undone || n.observed || pn.has(n.id) || t || r || Date.now() - (n.finished ?? 0) < gn || Date.now() - a < gn) continue;
				let e = vn(n, s, i);
				e !== null && (pn.add(n.id), p("/__inspector/observed", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						job: n.id,
						width: i,
						note: e
					})
				}).then(o).catch(() => pn.delete(n.id)));
			}
		}, 700);
		return () => window.clearInterval(e);
	}, []);
}
var bn = /^-?\d*\.?\d+m?s$/, xn = /^-?\d*\.?\d+$/;
function Sn(e, t) {
	let n = e.trim();
	if (!n) return null;
	if (Mt(n) && !/^(inherit|initial|unset|revert|revert-layer)$/i.test(n)) return /^rgb\(1, 2, 3\)$/.test(n) ? "rgb(250, 251, 252)" : "rgb(1, 2, 3)";
	if (bn.test(n)) return "7.777s";
	if (xn.test(n)) return String(n * 1.37 + .123);
	let r = `calc((${n}) * 1.31 + 3px)`;
	return t.CSS?.supports("width", r) ? r : null;
}
function Cn(e, t) {
	let n = [], r = (e, i) => {
		for (let a of Array.from(e)) {
			if ("selectorText" in a && "style" in a) {
				let e = a.cssText;
				n.push({
					rule: a,
					text: e,
					applies: i,
					hidden: /:\s*;/.test(e)
				});
			}
			let e = a.cssRules;
			if (e?.length) {
				let n = a.media?.mediaText;
				r(e, i && (!n || t.matchMedia(n).matches));
			}
		}
	};
	for (let n of Array.from(e.styleSheets)) try {
		r(n.cssRules, !n.media?.mediaText || t.matchMedia(n.media.mediaText).matches);
	} catch {}
	return n;
}
var wn = /::?(hover|focus|focus-visible|focus-within|active|visited|checked|disabled|target|before|after|placeholder|selection|marker|first-line|first-letter|backdrop)\b/g;
function Tn(e) {
	return e.split(",").map((e) => {
		let t = e.trim().replace(wn, "").split(/[\s>+~]+/).pop() ?? "", n = [...t.matchAll(/[.#][A-Za-z_][\w-]*/g)].map((e) => e[0]);
		return n.length ? n.join(", ") : t.match(/^[a-z][a-z0-9-]*/i)?.[0] ?? "";
	}).filter(Boolean).join(", ");
}
var En = 24;
function Dn(e, t, n) {
	let r = /* @__PURE__ */ new Map(), i = e?.defaultView, a = V(e, t), o = Object.keys(n);
	if (!e || !i || !a.length || !o.length) return r;
	let s = (e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), c = RegExp(`var\\(\\s*(?:${o.map(s).join("|")})\\s*[,)]`), l = Cn(e, i).filter((e) => e.hidden || c.test(e.text)), u = /* @__PURE__ */ new Map(), d = (e) => {
		let t = u.get(e);
		if (t) return t;
		if (t = [], e) try {
			for (let n of a) n.matches(e) && t.push(n), t.push(...n.querySelectorAll(e));
		} catch {}
		return u.set(e, t), t;
	}, f = [...a, ...a.flatMap((e) => [...e.querySelectorAll("[style*='var(']")])], p = e.createElement("style");
	p.textContent = "*, *::before, *::after { transition-property: none !important; }";
	let m = a.map((e) => !e.hasAttribute("style")), h = !1;
	try {
		for (let [t, o] of Object.entries(n)) {
			let n = RegExp(`var\\(\\s*${s(t)}\\s*[,)]`), c = /* @__PURE__ */ new Map(), u = !1, m = !1, g = !1, _ = (e, t) => {
				let n = c.get(e) ?? /* @__PURE__ */ new Set();
				for (let e = 0; e < t.length; e++) n.add(t[e]);
				c.set(e, n);
			};
			for (let e of l) {
				let t = n.test(e.text);
				if (!t && !e.hidden) continue;
				let r = d(e.rule.selectorText);
				e.applies && r.length ? (r.slice(0, En).forEach((t) => _(t, e.rule.style)), t ? m = !0 : g = !0) : t && !u && (r.length || d(Tn(e.rule.selectorText)).length) && (u = !0);
			}
			for (let e of f) n.test(e.getAttribute("style") ?? "") && (_(e, e.style), m = !0);
			if (!m && !g) {
				u || r.set(t, "unused");
				continue;
			}
			let v = Sn(o, i);
			if (!v) continue;
			h ||= (e.head.appendChild(p), !0);
			let y = () => [...c].map(([e, t]) => {
				let n = i.getComputedStyle(e);
				return [...t].map((e) => n.getPropertyValue(e)).join(";");
			}), b = y(), x = a.map((e) => [e.style.getPropertyValue(t), e.style.getPropertyPriority(t)]);
			a.forEach((e) => e.style.setProperty(t, v, "important"));
			let S = y().some((e, t) => e !== b[t]);
			a.forEach((e, n) => x[n][0] ? e.style.setProperty(t, x[n][0], x[n][1]) : e.style.removeProperty(t)), !S && m && r.set(t, "overridden");
		}
		a.forEach((e, t) => m[t] && !e.getAttribute("style") && e.removeAttribute("style")), h && i.getComputedStyle(a[0]).opacity;
	} finally {
		p.remove();
	}
	return r;
}
// runtime/panel-src/inspector/pageRules.ts
var On = (e) => e.replace(/\._([A-Za-z][\w-]*?)_[A-Za-z0-9-]{5}(?:_\d+)?(?![\w-])/g, ".$1");
function kn(e, t) {
	let n = e?.ownerNode, r = n?.getAttribute?.("data-vite-dev-id");
	if (r) return r;
	if (n?.tagName === "STYLE") return n.id?.startsWith("design-inspector") ? null : t.defaultView?.location.pathname ?? "/";
	let i = e?.href;
	return i && t.defaultView && new URL(i).origin === t.defaultView.location.origin ? new URL(i).pathname : null;
}
var An = /::?(hover|focus|focus-visible|focus-within|active|visited|checked|disabled|target|before|after|placeholder|selection|marker|first-line|first-letter|backdrop)\b/g, jn = /^(\*|html|body|:root|)$/i, Mn = (e) => e.split(",").every((e) => jn.test((e.trim().split(/[\s>+~]+/).pop() ?? "").replace(An, ""))), Nn = [
	"display",
	"grid-template-columns",
	"grid-template-rows",
	"grid-template-areas",
	"grid-auto-flow",
	"flex-direction",
	"flex-wrap",
	"column-gap",
	"row-gap",
	"columns"
], Pn = 150;
function Fn(e, t) {
	let n = V(e, t);
	if (!e || !n.length) return [];
	let r = n[0].parentElement, i = [], a = /* @__PURE__ */ new Map(), o = (e) => {
		try {
			for (let t of n) {
				if (t.matches(e)) return !0;
				for (let n of t.querySelectorAll(e)) if (nn(t, n)) return !0;
			}
		} catch {}
		return !1;
	}, s = (t) => {
		try {
			return !!r && r !== e.body && r.matches(t.selectorText.replace(An, "")) && Nn.some((e) => t.style.getPropertyValue(e));
		} catch {
			return !1;
		}
	}, c = (e, t) => {
		for (let n of Array.from(e)) {
			if ("selectorText" in n && "style" in n) {
				let e = n, r = On(e.selectorText), c = `${t}\n${r}`, l = a.get(c) ?? 0;
				if (a.set(c, l + 1), i.length >= Pn || Mn(e.selectorText)) continue;
				let u = e.selectorText.replace(An, "");
				u && o(u) ? i.push({
					source: t,
					selector: r,
					nth: l
				}) : s(e) && i.push({
					source: t,
					selector: r,
					nth: l,
					around: !0
				});
			}
			let e = n.cssRules;
			e?.length && c(e, t);
		}
	};
	for (let t of Array.from(e.styleSheets)) {
		let n = kn(t, e);
		if (n) try {
			c(t.cssRules, n);
		} catch {}
	}
	return i;
}
// runtime/panel-src/inspector/change.ts
var In = /* @__PURE__ */ new Map();
function Ln(e) {
	let t = In.get(e);
	if (t && Date.now() - t.at < 2e3) return t.rules.length ? { rules: t.rules } : void 0;
	let n = Fn(mn(), e);
	return In.set(e, {
		at: Date.now(),
		rules: n
	}), n.length ? { rules: n } : void 0;
}
window.__inspectorPageFacts = Ln;
var Rn = [
	{
		id: "claude-fable-5-2",
		label: "Fable 5.2"
	},
	{
		id: "claude-opus-5-5",
		label: "Opus 5.5"
	},
	{
		id: "claude-sonnet-5-5",
		label: "Sonnet 5.5"
	},
	{
		id: "claude-haiku-5-5",
		label: "Haiku 5.5"
	}
], zn = [
	"low",
	"medium",
	"high"
], Bn = [
	.5,
	1,
	2,
	5,
	0
], Vn = 3e3, Hn = 3.6, Un = /^(?!\.inspector\/|node_modules\/|dist\/)(?!(package(-lock)?|inspector\.map)\.json$)[\w./ -]+\.(tsx?|jsx?|mjs|cjs|css|json|html?)$/, Wn = {
	packages: [],
	files: [],
	allowNew: !1
}, Gn = {
	model: "claude-opus-5-5",
	effort: "medium",
	budget: 1
}, Kn = (e) => [...e.prompt.map((e) => `${e.where}: ${e.text}`), ...e.note ? [e.note] : []].join("\n"), qn = (e) => e.id === "site" ? "project" : "part", Jn = (e, t) => t.jobs.filter((t) => e.id === "site" ? t.mode === "project" : t.partId === e.id);
async function Yn({ part: e, request: t, continuing: n, settings: r, manual: i, extras: a = Wn, jobs: o }) {
	let s = qn(e);
	s === "part" && hn(e.id);
	let c = i ? [.../* @__PURE__ */ new Set([...i, ...a.files])] : null, l = await (await p("/__inspector/run", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			mode: s,
			part: e.label,
			prompt: Kn(e),
			request: t,
			partId: s === "part" ? e.id : void 0,
			page: s === "part" && !c ? Ln(e.id) : void 0,
			files: s === "part" ? c ?? void 0 : void 0,
			alsoFiles: s === "part" && !i && a.files.length ? a.files : void 0,
			packages: a.packages.length ? a.packages : void 0,
			allowNew: a.allowNew || void 0,
			thread: n?.thread,
			model: r.model,
			effort: r.effort,
			budget: s === "project" && r.budget ? r.budget : void 0
		})
	})).json();
	if (!l.ok) throw Error(l.error);
	return await o.refresh(), c;
}
function Xn(e, t) {
	let [n, r] = (0, E.useState)({}), i = [...new Set(e)].sort().join(",");
	return (0, E.useEffect)(() => {
		if (!i) return r({});
		p(`/__inspector/sizes?files=${encodeURIComponent(i)}`).then((e) => e.json()).then((e) => r(e.sizes)).catch(() => r({}));
	}, [i, t]), n;
}
var Zn = (e, t, n, r) => Math.round(Vn + (Kn(e).length + t.length) / 4 + n.reduce((e, t) => e + (r[t] ?? 0), 0) / Hn), Qn = (e, t) => [.../* @__PURE__ */ new Set([
	...e.edit,
	...t,
	...de
])];
// runtime/panel-src/inspector/tokenValues.ts
function $n(e) {
	let t = {};
	for (let n of e.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) t[n[1]] = n[2].trim();
	return t;
}
function er(e) {
	let t = e.replace(/\/\*[\s\S]*?\*\//g, (e) => " ".repeat(e.length)), n = {}, r = {};
	for (let e of t.matchAll(/:root\s*\{([^}]*)\}/g)) {
		let i = t.slice(0, e.index), a = (i.match(/\{/g) ?? []).length - (i.match(/\}/g) ?? []).length;
		Object.assign(a > 0 ? r : n, $n(e[1]));
	}
	return {
		desktop: n,
		mobile: r
	};
}
function tr(e, t) {
	let n = e.replace(/\/\*[\s\S]*?\*\//g, (e) => " ".repeat(e.length)), r = {};
	if (!n.includes("{")) return r;
	for (let e of t) if (e.id !== "site") for (let t of n.matchAll(Vt(Bt(e)))) {
		let i = n.slice(0, t.index), a = (i.match(/\{/g) ?? []).length - (i.match(/\}/g) ?? []).length, o = r[e.id] ??= {
			desktop: {},
			mobile: {}
		};
		Object.assign(a > 0 ? o.mobile : o.desktop, $n(t[0].slice(t[0].indexOf("{") + 1, -1)));
	}
	return r;
}
var nr = /^calc\(\s*(-?[\d.]+)\s*\*\s*var\(--u\)\s*\)$/, rr = /^(-?[\d.]+)em$/, ir = /^([\d.]+)ms$/, ar = /^(-?\d*\.?\d+)(px|rem|em|%|vw|vh|svh|dvh|vmin|vmax|ch)$/, or = /^(\d*\.?\d+)(ms|s)$/, sr = /^calc\(\s*(-?\d*\.?\d+)(px|rem)?\s*\*\s*(var\(--[\w-]+\)(?:\s*\*\s*var\(--[\w-]+\))*)\s*\)$/, cr = /^var\(\s*(--[\w-]+)\s*\)$/;
function lr(e) {
	let t = e.trim().match(/^clamp\((.*)\)$/);
	if (!t) return null;
	let n = [], r = 0, i = "";
	for (let e of t[1]) e === "(" && r++, e === ")" && r--, e === "," && r === 0 ? (n.push(i.trim()), i = "") : i += e;
	return n.push(i.trim()), n.length === 3 ? n : null;
}
var ur = (e, t) => e.replace(/(-?\d*\.?\d+)(px|rem|em|vw|vh|svh|dvh|%)/g, (e, n, r) => `${+(+n * t).toFixed(3)}${r}`), dr = (e, t) => e === "px" || e === "%" ? Math.abs(t) < 4 ? .5 : 1 : e === "s" ? .05 : e === "ms" ? 10 : .05;
function fr(e) {
	let t = e.trim(), n = t.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
	if (n) {
		let e = n[1].length <= 4 ? [...n[1]].map((e) => e + e).join("") : n[1];
		return {
			r: parseInt(e.slice(0, 2), 16),
			g: parseInt(e.slice(2, 4), 16),
			b: parseInt(e.slice(4, 6), 16),
			a: e.length === 8 ? +(parseInt(e.slice(6, 8), 16) / 255).toFixed(3) : 1
		};
	}
	let r = t.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+%?)\s*)?\)$/i);
	if (r) return {
		r: +r[1],
		g: +r[2],
		b: +r[3],
		a: pr(r[4])
	};
	let i = t.match(/^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/i);
	return i ? {
		r: +i[1],
		g: +i[2],
		b: +i[3],
		a: pr(i[4])
	} : null;
}
var pr = (e) => e === void 0 ? 1 : e.endsWith("%") ? e.slice(0, -1) / 100 : +e, mr = (e) => {
	let t = e.trim();
	return /^#([0-9a-f]{4}|[0-9a-f]{8})$/i.test(t) ? "hex8" : t.startsWith("#") ? "hex" : /^rgba?\([^,]*\s[\d.]+\s/.test(t) ? "space" : "comma";
}, hr = ({ r: e, g: t, b: n }) => "#" + [
	e,
	t,
	n
].map((e) => Math.round(e).toString(16).padStart(2, "0")).join("");
function gr(e, t = "hex") {
	let [n, r, i] = [
		e.r,
		e.g,
		e.b
	].map(Math.round), a = +e.a.toFixed(2);
	return t === "hex8" ? hr(e) + Math.round(e.a * 255).toString(16).padStart(2, "0") : t === "space" ? a >= 1 ? `rgb(${n} ${r} ${i})` : `rgb(${n} ${r} ${i} / ${a})` : e.a >= 1 ? t === "comma" ? `rgb(${n}, ${r}, ${i})` : hr(e) : `rgba(${n}, ${r}, ${i}, ${a})`;
}
var _r = (e, t, n) => ({ "--fill": `${n > t ? Math.min(100, Math.max(0, (e - t) / (n - t) * 100)) : 0}%` }), vr = [
	"font-size",
	"font-family",
	"font-weight",
	"font-style",
	"font-stretch",
	"letter-spacing",
	"line-height",
	"color",
	"text-transform",
	"word-spacing"
];
function yr(e) {
	let t = [], n = (r) => {
		for (let i of Array.from(r)) i instanceof e.defaultView.CSSStyleRule ? t.push(i) : "cssRules" in i && i.cssRules && n(i.cssRules);
	};
	for (let t of Array.from(e.styleSheets)) try {
		n(t.cssRules);
	} catch {}
	return t;
}
var br = (e, t) => {
	let n = e.style.getPropertyValue(t).trim();
	return !!n && !/^(inherit|unset|revert|revert-layer)$/.test(n);
};
function H(e) {
	let t = [];
	for (let n of e) {
		let e = vr.filter((e) => br(n, e));
		e.length && t.push({
			rule: n,
			properties: e
		});
	}
	return t;
}
function xr(e) {
	let t = e.ownerDocument.createTreeWalker(e, 4);
	for (let n = t.nextNode(); n; n = t.nextNode()) if (n.textContent?.trim() && Qt(n.parentElement) === e) return !0;
	return !1;
}
function Sr(e) {
	let t = /* @__PURE__ */ new Set(), n = e.ownerDocument.createTreeWalker(e, 4);
	for (let r = n.nextNode(); r; r = n.nextNode()) r.textContent?.trim() && r.parentElement && Qt(r.parentElement) === e && t.add(r.parentElement);
	return [...t];
}
var Cr = (e, t) => {
	try {
		return e.matches(t);
	} catch {
		return !1;
	}
};
function wr(e, t) {
	let n = Yt(t, e.id);
	if (!t || !n || !xr(n)) return [];
	let r = new Set(e.tokens), i = H(yr(t)), a = /* @__PURE__ */ new Map(), o = (e) => {
		let t = a.get(e);
		if (!t) {
			t = /* @__PURE__ */ new Set();
			for (let { rule: n, properties: r } of i) if (r.some((e) => !t.has(e)) && Cr(e, n.selectorText)) for (let e of r) t.add(e);
			a.set(e, t);
		}
		return t;
	}, s = [], c = /* @__PURE__ */ new Set(), l = new Set(o(n)), u = Sr(n);
	if (u.length) {
		let e = vr.filter((e) => !l.has(e));
		for (let t of u) {
			if (!e.length) break;
			let r = /* @__PURE__ */ new Set();
			for (let e = t; e && e !== n; e = e.parentElement) for (let t of o(e)) r.add(t);
			e = e.filter((e) => r.has(e));
		}
		for (let t of e) l.add(t);
		u.every((e) => e.closest("svg")) && l.add("color");
	}
	for (let e = n.parentElement; e; e = e.parentElement) {
		let t = j(tn(Qt(e))) || O[0], n = i.filter(({ rule: t }) => Cr(e, t.selectorText));
		for (let { rule: e, properties: i } of n) for (let n of i) {
			if (l.has(n)) continue;
			let i = e.style.getPropertyValue(n);
			for (let e of i.matchAll(/var\(\s*(--[\w-]+)/g)) {
				let i = e[1];
				r.has(i) || c.has(i) || !(i in ue) || (c.add(i), s.push({
					token: i,
					property: n,
					from: t
				}));
			}
		}
		for (let { properties: e } of n) for (let t of e) l.add(t);
	}
	return s;
}
// runtime/panel-src/inspector/directEdit.ts
var Tr = (e) => e ? ` (about ${e >= 1e3 ? `${(e / 1e3).toFixed(1)}k` : e} tokens)` : "";
function Er(e, t, n, r, i) {
	if (!e.ok) throw Error(e.error ?? "That couldn't be changed");
	if (e.direct) {
		let r = e.entry;
		n(t, r ? {
			label: "Undo",
			run: () => {
				at(), p("/__inspector/undo-edit", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ entry: r })
				}).then((e) => e.json()).then((e) => n(e.ok ? "Taken back" : e.error ?? "It couldn't be taken back")).catch(() => n("It couldn't be taken back")).finally(i);
			}
		} : void 0), i();
	} else n(`Not changed: ${e.why ?? "the studio can't be sure where this lives in the files"}.`, {
		label: `Ask Claude${Tr(e.tokens)}`,
		run: r
	});
}
// runtime/panel-src/inspector/MotionFound.tsx
var Dr = (e) => e.trim().endsWith("ms") ? parseFloat(e) / 1e3 : parseFloat(e) || 0, Or = (e) => kr(e).map((e) => e.trim()).filter(Boolean);
function kr(e) {
	let t = [], n = 0, r = "";
	for (let i of e) i === "(" && n++, i === ")" && n--, i === "," && n === 0 ? (t.push(r), r = "") : r += i;
	return t.push(r), t;
}
var Ar = /^-?\d*\.?\d+m?s$/;
function jr(e, t) {
	let n = Or(t).map((e) => e.replace(/\([^()]*\)/g, (e) => e.replace(/\s+/g, "")).split(/\s+/)), r = (e) => !Ar.test(e) && !/^(var|cubic-bezier|steps)\(/.test(e) && !/^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|infinite|alternate|alternate-reverse|reverse|normal|forwards|backwards|both|none|running|paused|\d+)$/.test(e);
	return {
		names: n.map((t) => t.find(r) ?? (e === "transition" ? "all" : "")),
		durations: n.map((e) => Dr(e.filter((e) => Ar.test(e))[0] ?? "0s")),
		delays: n.map((e) => Dr(e.filter((e) => Ar.test(e))[1] ?? "0s")),
		literal: n.map((e) => e.some((e) => Ar.test(e)))
	};
}
var Mr = (e) => `${+e.toFixed(3)}s`, Nr = (e, t) => kn(e.parentStyleSheet, t), Pr = (e) => e.parentRule?.conditionText ?? "", Fr = (e, t) => {
	try {
		return e.matches(t);
	} catch {
		return !1;
	}
};
function Ir(e, t) {
	let n = t.defaultView;
	if (!n) return [];
	let r = yr(t), i = [e, ...Array.from(e.querySelectorAll("*")).filter((t) => nn(e, t))].slice(0, 80), a = /* @__PURE__ */ new Map();
	for (let e of i) {
		let i = n.getComputedStyle(e);
		for (let o of ["transition", "animation"]) {
			if (o === "animation" && i.animationName === "none" || Or(i.getPropertyValue(`${o}-duration`)).every((e) => Dr(e) === 0)) continue;
			let s = [...r].reverse().find((t) => (t.style.getPropertyValue(`${o}-duration`) || t.style.getPropertyValue(o)) && Fr(e, t.selectorText) && (!Pr(t) || n.matchMedia(Pr(t)).matches));
			if (!s) continue;
			let c = Nr(s, t);
			if (!c || /\/__inspector\//.test(c)) continue;
			let l = `${c}|${Pr(s)}|${s.selectorText}|${o}`;
			if (a.has(l)) continue;
			let u = s.style.getPropertyValue(`${o}-duration`), d = jr(o, s.style.getPropertyValue(o));
			(u || !d.literal.some((e) => !e)) && a.set(l, {
				key: l,
				kind: o,
				rule: s,
				source: c,
				selector: /\.module\.css$/.test(c.split("?")[0]) ? On(s.selectorText) : s.selectorText,
				media: Pr(s),
				names: (u ? Or(s.style.getPropertyValue(o === "transition" ? "transition-property" : "animation-name")) : d.names).map(On),
				durations: u ? Or(u).map(Dr) : d.durations,
				delays: u ? Or(s.style.getPropertyValue(`${o}-delay`) || "0s").map(Dr) : d.delays
			});
		}
	}
	return [...a.values()];
}
function Lr({ part: e, doc: t, seen: n, version: r, settings: i, blocked: a, onStatus: o, onDone: s, onPlay: c }) {
	let [l, u] = (0, E.useState)([]), [d, f] = (0, E.useState)({});
	if ((0, E.useEffect)(() => {
		let n = Yt(t, e.id);
		u(n && t ? Ir(n, t) : []), f({});
	}, [
		e.id,
		t,
		n,
		r
	]), !l.length) return null;
	let m = (e, t) => (t === "duration" ? e.durations : e.delays).map((n, r) => d[`${e.key}|${t}|${r}`] ?? n), h = (e, t, n, r) => {
		f((i) => ({
			...i,
			[`${e.key}|${t}|${n}`]: r
		}));
		let i = m(e, t).map((e, t) => t === n ? r : e);
		e.rule.style.setProperty(`${e.kind}-${t}`, i.map(Mr).join(", "));
	}, g = async (t, n, r) => {
		let c = r ?? m(t, n), l = n === "duration" ? t.durations : t.delays;
		if (r || !c.every((e, t) => e === l[t])) {
			if (a) return o(a);
			o(`Setting the ${t.kind} ${n}…`);
			try {
				let a = await (await p("/__inspector/motion", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						partId: e.id,
						source: t.source,
						selector: t.selector,
						media: t.media,
						prop: `${t.kind}-${n}`,
						value: c.map(Mr).join(", "),
						model: i.model,
						effort: "low",
						claude: !!r
					})
				})).json();
				if (!a.ok) throw Error(a.error ?? "Couldn't set it");
				if (r && !a.direct) return o(`Sent to Claude: ${a.why ?? "it couldn't be done directly"}`), s();
				a.direct || (t.rule.style.setProperty(`${t.kind}-${n}`, l.map(Mr).join(", ")), f({})), Er(a, `The ${t.kind} ${n} is set in the file`, o, () => void g(t, n, c), s);
			} catch (e) {
				o(e instanceof Error ? e.message : "Couldn't set it");
			}
		}
	}, _ = (e, t, n, r) => /* @__PURE__ */ (0, P.jsxs)("div", {
		className: L.token,
		children: [/* @__PURE__ */ (0, P.jsx)("div", {
			className: L.tokenHead,
			children: /* @__PURE__ */ (0, P.jsxs)("strong", {
				className: L.tokenName,
				children: [t === "duration" ? "Duration" : "Delay", e.names.length > 1 ? ` · ${e.names[n] ?? e.names[0]}` : ""]
			})
		}), /* @__PURE__ */ (0, P.jsxs)("div", {
			className: L.number,
			children: [
				/* @__PURE__ */ (0, P.jsx)("input", {
					type: "range",
					min: 0,
					max: Math.max(2, r * 3),
					step: .05,
					value: r,
					style: _r(r, 0, Math.max(2, r * 3)),
					onChange: (r) => h(e, t, n, +r.target.value),
					onPointerUp: () => void g(e, t),
					onKeyUp: () => void g(e, t)
				}),
				/* @__PURE__ */ (0, P.jsx)("input", {
					type: "number",
					step: .05,
					value: +r.toFixed(3),
					onChange: (r) => h(e, t, n, +r.target.value),
					onBlur: () => void g(e, t),
					onKeyDown: (n) => n.key === "Enter" && void g(e, t)
				}),
				/* @__PURE__ */ (0, P.jsx)("span", { children: "s" })
			]
		})]
	}, `${t}${n}`);
	return /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [/* @__PURE__ */ (0, P.jsxs)("h3", {
		className: L.withPlay,
		children: ["Motion in the CSS ", /* @__PURE__ */ (0, P.jsx)(Vr, { onPlay: c })]
	}), l.map((e) => /* @__PURE__ */ (0, P.jsxs)("div", { children: [
		/* @__PURE__ */ (0, P.jsxs)("p", {
			className: L.role,
			children: [
				e.kind === "transition" ? "Transition" : "Animation",
				e.names.length ? `: ${e.names.join(", ")}` : "",
				" · ",
				/* @__PURE__ */ (0, P.jsx)("code", { children: e.selector }),
				e.media ? ` (${e.media})` : ""
			]
		}),
		m(e, "duration").map((t, n) => _(e, "duration", n, t)),
		m(e, "delay").map((t, n) => t > 0 || e.delays.some((e) => e > 0) ? _(e, "delay", n, t) : null)
	] }, e.key))] });
}
// runtime/panel-src/inspector/LayerExtras.tsx
async function Rr(e, t, n = !0) {
	return await (await p(e, {
		method: "POST",
		headers: n ? { "Content-Type": "application/json" } : { "Content-Type": "application/octet-stream" },
		body: t
	})).json();
}
function zr({ part: e, doc: t, seen: n, version: r, settings: i, blocked: a, onStatus: o, onDone: s, onPlay: c }) {
	let [l, u] = (0, E.useState)(null), [d, f] = (0, E.useState)(""), [p, m] = (0, E.useState)(null), h = (0, E.useRef)(null);
	(0, E.useEffect)(() => {
		let n = Yt(t, e.id), r = (e) => n ? Array.from(n.querySelectorAll(e)).filter((e) => nn(n, e)) : [], i = r("a[href]"), a = (n?.matches("a[href]") ? n : i.length === 1 ? i[0] : null)?.getAttribute("href") ?? null;
		u(a), f(a ?? "");
		let o = n?.matches("img, video") ? n : r("img, video")[0], s = o?.getAttribute("src") ?? o?.querySelector("source")?.getAttribute("src") ?? null, c = s ?? "";
		try {
			s && t && (c = new URL(s, t.baseURI).href);
		} catch {}
		m(s ? {
			src: s,
			shown: c,
			video: o?.tagName === "VIDEO"
		} : null);
	}, [
		e.id,
		t,
		n,
		r
	]);
	let g = (e, t, n, r) => {
		if (!e.ok) throw Error(e.error ?? `The ${t} couldn't be changed`);
		if (r && !e.direct) return o(`Sent to Claude: ${e.why ?? "it couldn't be done directly"}`), s();
		Er(e, `${t} changed in the file`, o, n, s);
	}, _ = async (e, t) => {
		if (a) return o(a);
		o(`Changing the ${e.toLowerCase()}…`);
		try {
			await t();
		} catch (t) {
			o(t instanceof Error ? t.message : `The ${e.toLowerCase()} couldn't be changed`);
		}
	}, v = (t = !1) => void (l !== null && d.trim() && d.trim() !== l ? _("Link", async () => g(await Rr("/__inspector/link", JSON.stringify({
		partId: e.id,
		from: l,
		to: d.trim(),
		model: i.model,
		effort: "low",
		claude: t
	})), "Link", () => v(!0), t)) : void 0), y = (t, n = !1) => void _("Image", async () => {
		let r = new URLSearchParams({
			part: e.id,
			name: t.name,
			from: p?.src ?? "",
			model: i.model,
			effort: "low",
			...n ? { claude: "1" } : {}
		});
		g(await Rr(`/__inspector/media?${r}`, t, !1), p?.video ? "Video" : "Image", () => y(t, !0), n);
	});
	return /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [
		l !== null && /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [/* @__PURE__ */ (0, P.jsx)("h3", { children: "Link" }), /* @__PURE__ */ (0, P.jsxs)("div", {
			className: L.linkRow,
			children: [/* @__PURE__ */ (0, P.jsx)("input", {
				value: d,
				onChange: (e) => f(e.target.value),
				onKeyDown: (e) => e.key === "Enter" && void v(),
				spellCheck: !1,
				"aria-label": `${e.label} link`,
				placeholder: "https://… or #section"
			}), /* @__PURE__ */ (0, P.jsx)("button", {
				type: "button",
				className: L.ghost,
				onClick: () => void v(),
				disabled: !d.trim() || d.trim() === l,
				children: "Set"
			})]
		})] }),
		p && /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [
			/* @__PURE__ */ (0, P.jsx)("h3", { children: p.video ? "Video" : "Image" }),
			/* @__PURE__ */ (0, P.jsxs)("div", {
				className: L.media,
				children: [p.video ? /* @__PURE__ */ (0, P.jsx)("video", {
					src: p.shown,
					muted: !0
				}) : /* @__PURE__ */ (0, P.jsx)("img", {
					src: p.shown,
					alt: ""
				}), /* @__PURE__ */ (0, P.jsxs)("div", { children: [/* @__PURE__ */ (0, P.jsx)("button", {
					type: "button",
					className: L.ghost,
					onClick: () => h.current?.click(),
					children: "Replace…"
				}), /* @__PURE__ */ (0, P.jsx)("small", {
					title: p.src,
					children: p.src
				})] })]
			}),
			/* @__PURE__ */ (0, P.jsx)("input", {
				ref: h,
				type: "file",
				accept: p.video ? "video/mp4,video/webm,video/quicktime" : "image/png,image/jpeg,image/webp,image/avif,image/gif,image/svg+xml",
				hidden: !0,
				onChange: (e) => {
					let t = e.target.files?.[0];
					e.target.value = "", t && y(t);
				}
			})
		] }),
		(e.params ?? []).some((e) => !oe(e)) && /* @__PURE__ */ (0, P.jsx)(Hr, {
			part: e,
			version: r,
			settings: i,
			blocked: a,
			onStatus: o,
			onDone: s,
			onPlay: c,
			motion: !1
		}),
		(e.params ?? []).some(oe) && /* @__PURE__ */ (0, P.jsx)(Hr, {
			part: e,
			version: r,
			settings: i,
			blocked: a,
			onStatus: o,
			onDone: s,
			onPlay: c,
			motion: !0
		}),
		/* @__PURE__ */ (0, P.jsx)(Lr, {
			part: e,
			doc: t,
			seen: n,
			version: r,
			settings: i,
			blocked: a,
			onStatus: o,
			onDone: s,
			onPlay: c
		})
	] });
}
function Br({ part: e, settings: t, jobs: n, blocked: r, onStatus: i }) {
	let a = async () => {
		if (r) return i(r);
		try {
			await Yn({
				part: e,
				request: `Delete ${e.label} from the page: remove its element and everything inside it, and the styles and code only it uses. Leave the rest of the layout as it is. List its id (and the ids of the parts inside it) in "map.remove".`,
				continuing: null,
				settings: t,
				manual: null,
				jobs: n
			}), i(`Deleting ${e.label}: Undo on its card brings it back`);
		} catch (e) {
			i(e instanceof Error ? e.message : "Couldn't start the delete");
		}
	};
	return /* @__PURE__ */ (0, P.jsx)("button", {
		type: "button",
		className: `${L.ghost} ${L.danger} ${L.deleteLayer}`,
		onClick: () => void a(),
		title: "Claude removes it from the code; Undo on the card brings it back",
		children: "Delete layer"
	});
}
function Vr({ onPlay: e, label: t = "Play" }) {
	return /* @__PURE__ */ (0, P.jsxs)("button", {
		type: "button",
		className: L.play,
		onClick: e,
		title: "Play the animation on the page, with the values you're editing",
		children: [/* @__PURE__ */ (0, P.jsx)("svg", {
			viewBox: "0 0 16 16",
			"aria-hidden": "true",
			children: /* @__PURE__ */ (0, P.jsx)("path", { d: "M5 3.5v9l7.5-4.5z" })
		}), t]
	});
}
function Hr({ part: e, version: t, settings: n, blocked: r, onStatus: i, onDone: a, onPlay: o, motion: s }) {
	let [c, l] = (0, E.useState)({}), [u, d] = (0, E.useState)({}), [f, m] = (0, E.useState)({});
	(0, E.useEffect)(() => {
		let t = !0;
		return p(`/__inspector/params?part=${encodeURIComponent(e.id)}`).then((e) => e.json()).then((e) => t && e.ok && (l(e.values), d(e.flags ?? {}), m({}))).catch(() => void 0), () => {
			t = !1;
		};
	}, [e.id, t]);
	let h = async (t) => {
		d((e) => t === "*" ? {} : Object.fromEntries(Object.entries(e).filter(([e]) => e !== t))), await Rr("/__inspector/setting-ok", JSON.stringify({
			partId: e.id,
			key: t
		})).catch(() => void 0);
	}, g = async (t, o) => {
		let s = se(t), l = o ?? f[s];
		if (!(l === void 0 || o === void 0 && l === c[s])) {
			if (r) return i(r);
			i(`Setting ${t.label}…`);
			try {
				let r = await Rr("/__inspector/param", JSON.stringify({
					partId: e.id,
					name: s,
					value: l,
					model: n.model,
					effort: "low",
					claude: o !== void 0
				}));
				if (!r.ok) throw Error(r.error ?? "Couldn't set it");
				if (o !== void 0 && !r.direct) return i(`Sent to Claude: ${r.why ?? "it couldn't be done directly"}`), a();
				r.direct || m((e) => Object.fromEntries(Object.entries(e).filter(([e]) => e !== s))), Er(r, `${t.label} set in the file`, i, () => void g(t, l), a);
			} catch (e) {
				i(e instanceof Error ? e.message : "Couldn't set it");
			}
		}
	};
	return /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [
		/* @__PURE__ */ (0, P.jsxs)("h3", {
			className: L.withPlay,
			children: [
				s ? "Animation timing" : "Effect",
				" ",
				/* @__PURE__ */ (0, P.jsx)(Vr, { onPlay: o })
			]
		}),
		(() => {
			let t = (e.params ?? []).filter((e) => oe(e) === s && u[se(e)]);
			if (!t.length) return null;
			let n = u[se(t[0])].by;
			return /* @__PURE__ */ (0, P.jsxs)("p", {
				className: L.phone,
				children: [
					t.length === 1 ? "1 setting" : `${t.length} settings`,
					" changed by “",
					n.slice(0, 70),
					"”. Each shows the number it points at now; check the ones that matter.",
					" ",
					/* @__PURE__ */ (0, P.jsx)("button", {
						type: "button",
						className: L.link,
						onClick: () => void h("*"),
						children: "All right"
					})
				]
			});
		})(),
		(e.params ?? []).filter((e) => oe(e) === s).map((e) => {
			let t = se(e), n = c[t], r = u[t];
			if (n === void 0) return null;
			if (n === null) return /* @__PURE__ */ (0, P.jsxs)("div", {
				className: L.token,
				children: [/* @__PURE__ */ (0, P.jsx)("div", {
					className: L.tokenHead,
					children: /* @__PURE__ */ (0, P.jsx)("strong", {
						className: L.tokenName,
						children: e.label
					})
				}), /* @__PURE__ */ (0, P.jsxs)("p", {
					className: L.phone,
					children: [
						"Lost its place in the code",
						r?.by && r.by !== "the map" ? ` after “${r.by.slice(0, 60)}”` : "",
						": the number after ",
						/* @__PURE__ */ (0, P.jsx)("code", { children: (e.find ?? e.name ?? "").slice(0, 40) }),
						" isn't in ",
						e.file,
						" once any more. Ask Claude to “fix the ",
						e.label,
						" setting”."
					]
				})]
			}, t);
			let i = f[t] ?? n, a = Math.abs(n) || 1, o = e.min ?? (n < 0 ? n * 3 : 0), s = e.max ?? a * 3, l = e.step ?? (s - o) / 200, d = (e) => m((n) => ({
				...n,
				[t]: e
			}));
			return /* @__PURE__ */ (0, P.jsxs)("div", {
				className: L.token,
				"data-changed": f[t] !== void 0 && f[t] !== n,
				children: [
					/* @__PURE__ */ (0, P.jsxs)("div", {
						className: L.tokenHead,
						children: [/* @__PURE__ */ (0, P.jsx)("strong", {
							className: L.tokenName,
							children: e.label
						}), r && /* @__PURE__ */ (0, P.jsx)("button", {
							type: "button",
							className: L.link,
							onClick: () => void h(t),
							title: "The number this setting points at is the right one",
							children: "it's right"
						})]
					}),
					r && /* @__PURE__ */ (0, P.jsxs)("p", {
						className: L.phone,
						children: [
							"Was ",
							r.was ?? "?",
							", now ",
							r.now,
							": check it's still the ",
							e.label.toLowerCase(),
							"."
						]
					}),
					/* @__PURE__ */ (0, P.jsxs)("div", {
						className: L.number,
						children: [
							/* @__PURE__ */ (0, P.jsx)("input", {
								type: "range",
								min: o,
								max: s,
								step: l,
								value: i,
								style: _r(i, o, s),
								onChange: (e) => d(+e.target.value),
								onPointerUp: () => void g(e),
								onKeyUp: () => void g(e)
							}),
							/* @__PURE__ */ (0, P.jsx)("input", {
								type: "number",
								step: l,
								value: +i.toFixed(4),
								onChange: (e) => d(+e.target.value),
								onBlur: () => void g(e),
								onKeyDown: (t) => t.key === "Enter" && void g(e)
							}),
							e.unit && /* @__PURE__ */ (0, P.jsx)("span", { children: e.unit })
						]
					})
				]
			}, t);
		})
	] });
}
// runtime/panel-src/inspector/switches.ts
var Ur = /* @__PURE__ */ new Set([
	"style",
	"tabindex",
	"src",
	"srcset",
	"href",
	"d",
	"transform",
	"x",
	"y",
	"width",
	"height",
	"value",
	"checked",
	"data-dm"
]), Wr = [
	"aria-",
	"data-design-inspector",
	"data-inspector"
], Gr = (e) => Ur.has(e) || Wr.some((t) => e.startsWith(t)), Kr = 4, qr = 400, Jr = /* @__PURE__ */ new WeakMap(), Yr = (e, t) => {
	let n = Math.max(e.x, t.x), r = Math.max(e.y, t.y);
	return {
		x: n,
		y: r,
		w: Math.min(e.x + e.w, t.x + t.w) - n,
		h: Math.min(e.y + e.h, t.y + t.h) - r
	};
};
function Xr(e, t) {
	let n = e.getBoundingClientRect(), r = t.getComputedStyle(e).transform, i = r && r !== "none" ? r.match(/matrix\(([^)]+)\)/) : null;
	if (i) {
		let [t, r] = i[1].split(",").map(Number);
		if (Math.abs(r) > .01 && e.offsetWidth && e.offsetHeight) {
			let i = Math.atan2(r, t), a = Math.abs(Math.cos(i)), o = Math.abs(Math.sin(i)), s = e.offsetWidth / e.offsetHeight, c = (n.width / (s * a + o) + n.height / (s * o + a)) / 2, l = c * s;
			return {
				x: n.left + n.width / 2 - l / 2,
				y: n.top + n.height / 2 - c / 2,
				w: l,
				h: c
			};
		}
	}
	return {
		x: n.left,
		y: n.top,
		w: n.width,
		h: n.height
	};
}
function Zr(e, t = 60) {
	let n = /* @__PURE__ */ new Set(), r = e.ownerDocument.createTreeWalker(e, 4);
	for (let i = r.nextNode(); i && n.size < t; i = r.nextNode()) i.textContent?.trim() && i.parentElement && Qt(i.parentElement) === e && n.add(i.parentElement);
	return [...n];
}
var Qr = (e) => e.checkVisibility?.({
	opacityProperty: !0,
	visibilityProperty: !0
}) ?? !0, $r = .1;
function ei(e, t) {
	let n = 1;
	for (let r = e; r && n > $r; r = r.parentElement) n *= Number(t.getComputedStyle(r).opacity) || 0;
	return n <= $r;
}
var ti = (e, t) => {
	let n = e.getBoundingClientRect();
	return n.width > 2 && n.height > 2 && n.bottom > 0 && n.top < t.innerHeight && n.right > 0 && n.left < t.innerWidth;
}, ni = 300, ri = 3e3, ii = 2500, ai = 4e3, oi = "img, video, canvas, svg, picture", si = /* @__PURE__ */ new WeakMap();
function ci(e, t) {
	let n = performance.now(), r = si.get(e);
	if (r && n - r.at < ni) return r;
	let i = !r || n - r.listed >= ri, a = i ? Zr(e, ii) : r.leaves, o = !1, s = !1;
	for (let e of a) if (Qr(e)) {
		if (s = ti(e, t)) break;
	} else o ||= ti(e, t);
	let c = {
		at: n,
		listed: i ? n : r.listed,
		leaves: a,
		seen: s,
		waiting: o,
		hidden: null
	};
	return si.set(e, c), c;
}
function li(e, t) {
	let n = ci(e, t);
	return n.hidden ??= n.waiting && !n.seen && !di(e, t);
}
function ui(e, t) {
	let n = t.getComputedStyle(e), r = (e) => e === "transparent" ? 0 : /^rgba|\//.test(e) ? e.match(/[\d.]+/g)?.map(Number)[3] ?? 1 : 1;
	return /url\(|gradient\(/.test(n.backgroundImage) || r(n.backgroundColor) > .05 ? !0 : n.borderTopStyle !== "none" && parseFloat(n.borderTopWidth) > 0 && r(n.borderTopColor) > .05;
}
function di(e, t) {
	if (e.matches(oi) || ui(e, t)) return !0;
	let n = 0;
	for (let r of e.querySelectorAll("*")) {
		if (++n > ai) break;
		if (ti(r, t) && Qr(r) && (r.matches(oi) || ui(r, t))) return !0;
	}
	return en(e).some((e) => Qr(e) && ti(e, t) && ci(e, t).seen);
}
var fi = /* @__PURE__ */ new Set([
	"IMG",
	"VIDEO",
	"PICTURE"
]), pi = (e) => /gradient\(/.test(e) && !/transparent|rgba\(|\/\s*[\d.]+%?\s*\)/.test(e);
function mi(e, t, n) {
	let r = [];
	for (let n = e; n && !n.contains(t); n = n.parentElement) r.push(n);
	let i = 1;
	for (let e = r.length - 1; e >= 0; e--) {
		let t = n.getComputedStyle(r[e]);
		if (i *= +t.opacity, i < .9) return !1;
		let a = t.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [], o = /^rgba|\//.test(t.backgroundColor) ? a[3] ?? 1 : +!!a.length;
		if (a.length && o >= .9 && t.backgroundColor !== "transparent" || fi.has(r[e].tagName) || /url\(/.test(t.backgroundImage) || pi(t.backgroundImage)) return !0;
	}
	return !1;
}
function hi(e, t, n, r) {
	let i = Jr.get(e), a = performance.now();
	if (i && a - i.at < qr) return i.by;
	let o = null;
	if (r.getComputedStyle(e).pointerEvents !== "none") {
		let i = [
			[.5, .5],
			[.25, .25],
			[.75, .25],
			[.25, .75],
			[.75, .75]
		].map(([e, n]) => [t.x + t.w * e, t.y + t.h * n]).map(([e, t]) => n.elementFromPoint(e, t)).filter((e) => !!e);
		if (i.length && !i.some((t) => t === e || e.contains(t) || t.contains(e)) && i.every((t) => mi(t, e, r))) {
			let e = i[0], t = tn(Qt(e));
			o = t ? j(t)?.label ?? t : `<${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""}>`;
		}
	}
	return Jr.set(e, {
		at: a,
		by: o
	}), o;
}
var gi = /* @__PURE__ */ new WeakMap();
function _i(e, t, n) {
	let r = performance.now(), i = gi.get(e);
	if (i && r - i.at < 1e3) return i.list;
	let a = [];
	for (let r = e.parentElement, i = 0; r && r !== t.body && i < 20; r = r.parentElement, i++) {
		let e = n.getComputedStyle(r);
		(e.overflowX !== "visible" || e.overflowY !== "visible") && a.push(r);
	}
	return gi.set(e, {
		at: r,
		list: a
	}), a;
}
function vi(e, t, n) {
	let r = n.SVGGeometryElement;
	if (!r || !(e instanceof r) || t.w >= Kr && t.h >= Kr) return t;
	let i = n.getComputedStyle(e);
	if (i.stroke === "none" || !i.stroke) return t;
	let a = e.getScreenCTM(), o = (parseFloat(i.strokeWidth) || 1) * (a ? Math.hypot(a.a, a.b) : 1);
	return t.h < o && (t = {
		...t,
		y: t.y + t.h / 2 - o / 2,
		h: o
	}), t.w < o && (t = {
		...t,
		x: t.x + t.w / 2 - o / 2,
		w: o
	}), t;
}
function yi(e, t, n, r = {}) {
	if (!e.isConnected) return {
		rects: [],
		why: "not on the page"
	};
	if (!e.getClientRects().length) return {
		rects: [],
		why: "not displayed (display: none, or a parent is)"
	};
	if (!Qr(e) || ei(e, n)) return {
		rects: [],
		why: "transparent or hidden (opacity 0 or visibility: hidden), maybe waiting for an intro or a reveal"
	};
	let i = vi(e, Xr(e, n), n), a = e instanceof n.HTMLElement && (e.scrollHeight > e.clientHeight + Kr || e.scrollWidth > e.clientWidth + Kr), o = (i.w < Kr || i.h < Kr) && i.w > 0 && i.h > 0 && Math.max(i.w, i.h) >= 8 && !a ? .01 : Kr;
	if (i.w < o || i.h < o) return {
		rects: [],
		why: `collapsed (${Math.round(i.w)} × ${Math.round(i.h)} px): open it in Preview`
	};
	i = Yr(i, {
		x: 0,
		y: 0,
		w: n.innerWidth,
		h: n.innerHeight
	});
	for (let r of _i(e, t, n)) {
		let e = r.getBoundingClientRect();
		i = Yr(i, {
			x: e.left,
			y: e.top,
			w: e.width,
			h: e.height
		});
	}
	if (i.w < o || i.h < o) return {
		rects: [],
		why: "outside the screen at this scroll position"
	};
	if (li(e, n)) return {
		rects: [],
		why: "its words are transparent (revealed later, letter by letter or on scroll)"
	};
	if (r.cover !== !1) {
		let r = hi(e, i, t, n);
		if (r) return {
			rects: [],
			why: `covered by ${r}`
		};
	}
	return {
		rects: [{
			x: Math.round(i.x),
			y: Math.round(i.y),
			w: Math.round(i.w),
			h: Math.round(i.h)
		}],
		why: null
	};
}
function bi(e, t, n) {
	let r = V(t, e);
	if (!r.length) return {
		rects: [],
		why: "not on this page"
	};
	let i = r.map((e) => yi(e, t, n)), a = i.flatMap((e) => e.rects);
	return a.length ? {
		rects: a,
		why: null
	} : {
		rects: [],
		why: i[0].why
	};
}
var xi = /* @__PURE__ */ new WeakMap();
function Si(e) {
	let t = e.defaultView;
	if (!t || xi.has(e)) return;
	let n = /* @__PURE__ */ new Map();
	xi.set(e, n);
	let r = t.MutationObserver;
	new r((e) => {
		for (let t of e) {
			let e = t.target;
			if (t.type !== "attributes" || !t.attributeName || Gr(t.attributeName)) continue;
			let r = tn(Qt(e));
			if (!r) continue;
			let i = n.get(r) ?? [];
			if (t.attributeName === "class") {
				let n = new Set((t.oldValue ?? "").split(/\s+/).filter(Boolean));
				for (let t of e.classList) !n.has(t) && !i.some((n) => n.el === e && n.kind === "class" && n.name === t) && i.push({
					el: e,
					kind: "class",
					name: t,
					value: null
				});
			} else e.hasAttribute(t.attributeName) && !i.some((n) => n.el === e && n.kind === "attr" && n.name === t.attributeName) && i.push({
				el: e,
				kind: "attr",
				name: t.attributeName,
				value: e.getAttribute(t.attributeName)
			});
			n.set(r, i.slice(-24));
		}
	}).observe(e.documentElement, {
		subtree: !0,
		attributes: !0,
		attributeOldValue: !0
	});
}
function Ci(e, t) {
	let n = xi.get(e);
	return n ? t.flatMap((e) => n.get(e) ?? []).filter((e) => e.kind === "class" ? e.el.classList.contains(e.name) : e.el.getAttribute(e.name) === e.value) : [];
}
var wi = (e, t) => new Promise((n) => {
	let r = (t) => t ? e.requestAnimationFrame(() => r(t - 1)) : n();
	r(t);
}), Ti = "", Ei = /* @__PURE__ */ new Map(), Di = /* @__PURE__ */ new Set(), Oi = 0, ki = (e) => `design-inspector:seen:${D.name}:${e.location.pathname}:${e.innerWidth}`;
function Ai(e) {
	let t = ki(e);
	if (t !== Ti) {
		Ti = t, Ei = /* @__PURE__ */ new Map(), Di = /* @__PURE__ */ new Set();
		try {
			let e = JSON.parse(localStorage.getItem(t) ?? "{}");
			for (let [t, n] of Object.entries(e.seen ?? {})) typeof n?.y == "number" && Ei.set(t, n);
			for (let t of e.missed ?? []) Di.add(t);
		} catch {}
	}
}
function ji() {
	Oi ||= window.setTimeout(() => {
		Oi = 0;
		try {
			localStorage.setItem(Ti, JSON.stringify({
				seen: Object.fromEntries(Ei),
				missed: [...Di]
			}));
		} catch {}
	}, 1500);
}
function Mi(e, t) {
	Ai(e);
	let n = Math.round(e.scrollY);
	for (let e of t) {
		if (!e.rects.length) continue;
		let t = e.rects.reduce((e, t) => e + t.w * t.h, 0), r = Ei.get(e.id);
		(!r || t >= r.area * .9) && (r && r.y === n && r.area === t || (Ei.set(e.id, {
			y: n,
			area: t
		}), ji())), Di.delete(e.id) && ji();
	}
}
function Ni(e, t, n) {
	return V(t, e).slice(0, 3).map((e) => {
		let t = e.getBoundingClientRect(), r = Zr(e)[0];
		return `${Math.round(t.x)},${Math.round(t.y)},${Math.round(t.width)},${Math.round(t.height)},${n.getComputedStyle(e).opacity},${r ? n.getComputedStyle(r).opacity : ""}`;
	}).join("|");
}
var Pi = (e, t) => V(t, e).slice(0, 3).flatMap((e) => e.getAnimations?.({ subtree: !0 }) ?? []), Fi = (e) => (e.effect?.getComputedTiming().iterations ?? 1) === Infinity, Ii = (e, t) => Pi(e, t).some((e) => e.playState === "running" && !Fi(e)), Li = (e, t) => Pi(e, t).some((e) => e.playState === "running" && Fi(e)), Ri = 40, zi = 3, Bi = 180;
async function Vi(e, t, n, r, i, a = !1) {
	let o = performance.now();
	await wi(n, 2);
	let s = n.scrollY, c = Ni(e, t, n), l = 0, u = 0, d = 0;
	for (;;) {
		if (i.gone()) return !1;
		if (!bi(e, t, n).why) return !0;
		if (performance.now() - o >= r) return !1;
		await new Promise((e) => setTimeout(e, Ri)), await wi(n, 1);
		let f = n.scrollY, p = Ni(e, t, n);
		if (u++, p !== c && d++, !i.restless && u >= 6 && d === u && !Ii(e, t) && (i.restless = !0), l = f === s && (i.restless || p === c) && !Ii(e, t) ? l + 1 : 0, s = f, c = p, l >= zi && performance.now() - o >= Bi && !(i.restless && a)) return !bi(e, t, n).why;
	}
}
function Hi(e, t) {
	let n = 0;
	for (let r of e.elementsFromPoint(t.innerWidth / 2, 2)) {
		let e = t.getComputedStyle(r);
		(e.position === "fixed" || e.position === "sticky") && r.getBoundingClientRect().top <= 2 && r.getBoundingClientRect().height < t.innerHeight / 3 && (n = Math.max(n, r.getBoundingClientRect().bottom));
	}
	return n;
}
function Ui(e, t, n) {
	for (let r = e.parentElement; r && r !== t.body; r = r.parentElement) {
		let e = n.getComputedStyle(r), t = (r.parentElement?.classList.contains("pin-spacer") ? r.parentElement : null) ?? (e.position === "sticky" ? r.parentElement : null);
		if (t) {
			let e = t.getBoundingClientRect().top + n.scrollY;
			return [Math.max(0, e - n.innerHeight * .1), Math.max(e, e + t.offsetHeight - n.innerHeight)];
		}
	}
	return null;
}
function Wi(e, t) {
	let n = e.getBoundingClientRect();
	if (n.height < t.innerHeight * 1.5) return null;
	let r = Math.max(0, n.top + t.scrollY);
	return [r, r + n.height - t.innerHeight];
}
function Gi(e, t, n) {
	for (let r = e; r && r !== t.body; r = r.parentElement) if (n.getComputedStyle(r).position === "fixed") return !0;
	return !1;
}
var Ki = 4e3, qi = 2e4, Ji = 1400, Yi = 900, Xi = 900, Zi = null, Qi = (e = "hand") => Zi?.cancel(e);
async function $i(e, t, n, r, i = {}) {
	Zi && (Zi.cancel("pick"), await Zi.done);
	let a = null, o = () => void 0, s = {
		cancel: (e) => void (a ??= e),
		done: new Promise((e) => o = e)
	};
	Zi = s;
	let c = n.scrollY, l = (e) => n.scrollTo({
		top: e,
		behavior: "instant"
	}), u = () => s.cancel("hand");
	n.addEventListener("wheel", u, { passive: !0 }), n.addEventListener("touchmove", u, { passive: !0 }), n.addEventListener("keydown", u);
	let d = { state: "cancelled" }, f = !1;
	try {
		Ai(n);
		let o = {
			restless: Li(e, t),
			gone: () => a !== null
		}, s = V(t, e), c = s.find((e) => e.getClientRects().length) ?? s[0], u = (e) => d = o.gone() ? { state: "cancelled" } : e, p = () => (Di.delete(e), Mi(n, [{
			id: e,
			rects: bi(e, t, n).rects
		}]), { state: "shown" });
		if (!c) return u({
			state: "not-here",
			why: "it isn't on this page"
		});
		if (!c.getClientRects().length) return u({
			state: "not-here",
			why: bi(e, t, n).why ?? "not displayed"
		});
		let m = Math.max(0, t.documentElement.scrollHeight - n.innerHeight), h = async (r, i, a = !1) => (l(r), Vi(e, t, n, i, o, a));
		if (r !== void 0) return u(await h(r <= 1 ? r * m : r, Ji, !0) ? p() : {
			state: "not-here",
			why: bi(e, t, n).why ?? "not shown where the map says"
		});
		let g = Ei.get(e);
		if (g && await h(Math.min(g.y, m), Yi)) return u(p());
		if (o.gone()) return u(d);
		let _ = c.getBoundingClientRect(), v = Hi(t, n), y = _.height > n.innerHeight - v ? n.scrollY + _.top - v - 8 : n.scrollY + _.top + _.height / 2 - n.innerHeight / 2;
		if (await h(y, Ji, !0)) return u(p());
		if (o.gone()) return u(d);
		let b = bi(e, t, n).why ?? "not shown", x = Ui(c, t, n) ?? Wi(c, n), S = !x && Gi(c, t, n);
		if (!i.thorough) {
			if (Di.has(e)) return u({
				state: "not-found",
				why: `${b}. It wasn't found anywhere on this page last time`,
				more: !0
			});
			if (!x && !S) return u({
				state: "not-found",
				why: `${b}. It may only show in some state of the page`,
				more: !0
			});
		}
		f = !0;
		let ee = performance.now(), C = i.thorough ? qi : x ? 7e3 : Ki, w = x ?? [0, m], te = (e) => Math.round(w[0] + (w[1] - w[0]) * e / 10);
		for (let e of [...Array(11).keys(), ...x || i.thorough ? Array.from({ length: 10 }, (e, t) => t + .5) : []]) {
			if (o.gone()) return u(d);
			if (performance.now() - ee > C) return u({
				state: "not-found",
				why: `${b}. Not found in ${Math.round(C / 1e3)} s of looking`,
				more: !i.thorough
			});
			if (!(Math.abs(te(e) - y) < 16) && await h(te(e), Xi)) return u(p());
		}
		return o.gone() ? u(d) : (Di.add(e), ji(), u({
			state: "not-found",
			why: `${b}. Not shown anywhere on this page`,
			more: !i.thorough
		}));
	} finally {
		n.removeEventListener("wheel", u), n.removeEventListener("touchmove", u), n.removeEventListener("keydown", u), f && d.state !== "shown" && a !== "hand" && l(c), Zi === s && (Zi = null), o();
	}
}
// runtime/panel-src/inspector/play.ts
var ea = /^data-(ready|inview|in-view|visible|shown|show|revealed|reveal|loaded|entered|in|animate|animated|played|seen)$/i, ta = /^(is-)?(ready|inview|in-view|visible|shown|show|revealed|loaded|entered|in|animate|animated|seen)$/i, U = /^(|true|1|yes|on)$/i, na = "data-design-inspector-replay", ra = "data-design-inspector-hover", ia = (e, t) => t === e || Qt(t.parentElement) === e;
function aa(e, t) {
	let n = e.defaultView;
	return (t.getAnimations?.({ subtree: !0 }) ?? []).filter((e) => {
		let r = e.effect?.target ?? null;
		return !(e instanceof n.CSSTransition) && (!e.timeline || e.timeline instanceof n.DocumentTimeline) && (!r || ia(t, r));
	});
}
function oa(e, t) {
	let n = /* @__PURE__ */ new Set(), r = [];
	for (let i of Array.from(e.styleSheets)) {
		let e;
		try {
			e = i.cssRules;
		} catch {
			continue;
		}
		let a = (e) => {
			for (let i of Array.from(e)) {
				"cssRules" in i && i.cssRules && !i.selectorText && a(i.cssRules);
				let e = i.selectorText;
				if (!e || !/:hover/.test(e)) continue;
				let o = e.replace(/:hover/g, ""), s = [];
				try {
					s = [t, ...Array.from(t.querySelectorAll("*"))].filter((e) => ia(t, e) && e.matches(o));
				} catch {
					continue;
				}
				if (!s.length) continue;
				let c = e.slice(0, e.indexOf(":hover")).split(/[\s>+~]+/).pop() ?? "";
				for (let e of s) {
					let t = e;
					try {
						for (; t && !t.matches(c || "*");) t = t.parentElement;
					} catch {
						t = e;
					}
					t && n.add(t);
				}
				r.push(i.cssText.replace(/:hover/g, `[${ra}]`));
			}
		};
		a(e);
	}
	if (!n.size) return [];
	let i = e.getElementById(ra);
	return i || (i = e.createElement("style"), i.id = ra, e.head.appendChild(i)), i.textContent = r.join("\n"), [...n];
}
async function sa(e, t, n) {
	let r = e.defaultView ?? window, i = (e) => new Promise((t) => e ? r.requestAnimationFrame(() => void i(e - 1).then(t)) : t()), a = aa(e, t);
	if (a.length) {
		for (let e of a) e.cancel(), e.play();
		return "animations";
	}
	let o = oa(e, t);
	if (o.length) return o.forEach((e) => e.setAttribute(ra, "")), r.setTimeout(() => o.forEach((e) => e.removeAttribute(ra)), 1600), "hover";
	let s = Ci(e, n);
	if (!s.length) {
		let n = [];
		for (let r = t; r && r !== e.documentElement; r = r.parentElement) n.push(r);
		n.push(...Array.from(t.querySelectorAll("*")).filter((e) => ia(t, e)).slice(0, 2e3));
		for (let e of n) {
			for (let t of Array.from(e.attributes)) ea.test(t.name) && U.test(t.value) && s.push({
				el: e,
				kind: "attr",
				name: t.name,
				value: t.value
			});
			for (let t of Array.from(e.classList)) ta.test(t) && s.push({
				el: e,
				kind: "class",
				name: t,
				value: null
			});
		}
	}
	if (s = s.filter((e) => e.el.isConnected), !s.length) return "reload";
	let c = s.map((e) => e.kind === "attr" ? (e.el.removeAttribute(e.name), () => e.el.setAttribute(e.name, e.value ?? "")) : (e.el.classList.remove(e.name), () => e.el.classList.add(e.name))), l = e.getElementById(na);
	l || (l = e.createElement("style"), l.id = na, l.textContent = `[${na}], [${na}] * { transition: none !important; }`, e.head.appendChild(l));
	let u = t;
	for (; u.parentElement && u.parentElement !== e.body;) u = u.parentElement;
	return u.setAttribute(na, ""), u.offsetHeight, u.removeAttribute(na), u.offsetHeight, await i(2), c.forEach((e) => e()), await i(2), (t.getAnimations?.({ subtree: !0 }) ?? []).length + (u === t ? 0 : (u.getAnimations?.({ subtree: !0 }) ?? []).length) ? "states" : "reload";
}
// runtime/panel-src/inspector/EasingControl.tsx
var ca = [
	{
		label: "Linear",
		curve: [
			0,
			0,
			1,
			1
		],
		keyword: "linear"
	},
	{
		label: "Ease",
		curve: [
			.25,
			.1,
			.25,
			1
		],
		keyword: "ease"
	},
	{
		label: "Ease in",
		curve: [
			.42,
			0,
			1,
			1
		],
		keyword: "ease-in"
	},
	{
		label: "Ease out",
		curve: [
			0,
			0,
			.58,
			1
		],
		keyword: "ease-out"
	},
	{
		label: "Ease in-out",
		curve: [
			.42,
			0,
			.58,
			1
		],
		keyword: "ease-in-out"
	},
	{
		label: "Sine in",
		curve: [
			.12,
			0,
			.39,
			0
		]
	},
	{
		label: "Sine out",
		curve: [
			.61,
			1,
			.88,
			1
		]
	},
	{
		label: "Sine in-out",
		curve: [
			.37,
			0,
			.63,
			1
		]
	},
	{
		label: "Quad in",
		curve: [
			.11,
			0,
			.5,
			0
		]
	},
	{
		label: "Quad out",
		curve: [
			.5,
			1,
			.89,
			1
		]
	},
	{
		label: "Quad in-out",
		curve: [
			.45,
			0,
			.55,
			1
		]
	},
	{
		label: "Cubic in",
		curve: [
			.32,
			0,
			.67,
			0
		]
	},
	{
		label: "Cubic out",
		curve: [
			.33,
			1,
			.68,
			1
		]
	},
	{
		label: "Cubic in-out",
		curve: [
			.65,
			0,
			.35,
			1
		]
	},
	{
		label: "Quart in",
		curve: [
			.5,
			0,
			.75,
			0
		]
	},
	{
		label: "Quart out",
		curve: [
			.25,
			1,
			.5,
			1
		]
	},
	{
		label: "Quart in-out",
		curve: [
			.76,
			0,
			.24,
			1
		]
	},
	{
		label: "Quint in",
		curve: [
			.64,
			0,
			.78,
			0
		]
	},
	{
		label: "Quint out",
		curve: [
			.22,
			1,
			.36,
			1
		]
	},
	{
		label: "Quint in-out",
		curve: [
			.83,
			0,
			.17,
			1
		]
	},
	{
		label: "Expo in",
		curve: [
			.7,
			0,
			.84,
			0
		]
	},
	{
		label: "Expo out",
		curve: [
			.16,
			1,
			.3,
			1
		]
	},
	{
		label: "Expo in-out",
		curve: [
			.87,
			0,
			.13,
			1
		]
	},
	{
		label: "Circ in",
		curve: [
			.55,
			0,
			1,
			.45
		]
	},
	{
		label: "Circ out",
		curve: [
			0,
			.55,
			.45,
			1
		]
	},
	{
		label: "Circ in-out",
		curve: [
			.85,
			0,
			.15,
			1
		]
	},
	{
		label: "Back in",
		curve: [
			.36,
			0,
			.66,
			-.56
		]
	},
	{
		label: "Back out",
		curve: [
			.34,
			1.56,
			.64,
			1
		]
	},
	{
		label: "Back in-out",
		curve: [
			.68,
			-.6,
			.32,
			1.6
		]
	}
], la = new Map(ca.filter((e) => e.keyword).map((e) => [e.keyword, e.curve])), ua = /^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/;
function da(e) {
	let t = e.trim(), n = la.get(t);
	if (n) return n;
	let r = t.match(ua);
	return r ? [
		+r[1],
		+r[2],
		+r[3],
		+r[4]
	] : null;
}
var fa = (e) => da(e) !== null, pa = (e) => Math.round(e * 100) / 100, ma = (e, t) => e.every((e, n) => Math.abs(e - t[n]) < .005);
function ha(e) {
	return ca.find((t) => t.keyword && ma(t.curve, e))?.keyword ?? `cubic-bezier(${e.map(pa).join(", ")})`;
}
var ga = 220, _a = 20, va = 180, ya = 46, ba = 272, xa = (e) => _a + e * va, Sa = (e) => ya + (1 - e) * va, Ca = 1100;
function wa({ value: e, onChange: t, onPlay: n }) {
	let r = da(e) ?? [
		.25,
		.1,
		.25,
		1
	], i = (0, E.useRef)(null), [a, o] = (0, E.useState)(null), [s, c] = (0, E.useState)(0), l = ca.find((e) => ma(e.curve, r));
	(0, E.useEffect)(() => c((e) => e + 1), [e]);
	let u = (e) => {
		if (a === null || !i.current) return;
		let n = i.current.getBoundingClientRect(), o = Math.min(1, Math.max(0, ((e.clientX - n.left) / n.width * ga - _a) / va)), s = Math.min(2, Math.max(-1, 1 - ((e.clientY - n.top) / n.height * ba - ya) / va)), c = [...r];
		c[a * 2] = pa(o), c[a * 2 + 1] = pa(s), t(ha(c));
	}, d = (e, n) => {
		if (!Number.isFinite(n)) return;
		let i = [...r];
		i[e] = e % 2 == 0 ? Math.min(1, Math.max(0, n)) : n, t(ha(i));
	}, [f, p, m, h] = r, g = `M${xa(0)},${Sa(0)} C${xa(f)},${Sa(p)} ${xa(m)},${Sa(h)} ${xa(1)},${Sa(1)}`;
	return /* @__PURE__ */ (0, P.jsxs)("div", {
		className: L.easing,
		children: [
			/* @__PURE__ */ (0, P.jsxs)("select", {
				value: l?.label ?? "custom",
				onChange: (e) => t(ha(ca.find((t) => t.label === e.target.value)?.curve ?? r)),
				"aria-label": "Easing preset",
				children: [!l && /* @__PURE__ */ (0, P.jsx)("option", {
					value: "custom",
					children: "Custom curve"
				}), ca.map((e) => /* @__PURE__ */ (0, P.jsx)("option", {
					value: e.label,
					children: e.label
				}, e.label))]
			}),
			/* @__PURE__ */ (0, P.jsxs)("svg", {
				ref: i,
				viewBox: `0 0 ${ga} ${ba}`,
				className: L.graph,
				onPointerMove: u,
				onPointerUp: () => o(null),
				onPointerCancel: () => o(null),
				role: "img",
				"aria-label": `Easing curve ${ha(r)}`,
				children: [
					/* @__PURE__ */ (0, P.jsx)("rect", {
						x: _a,
						y: ya,
						width: va,
						height: va,
						className: L.graphBox
					}),
					/* @__PURE__ */ (0, P.jsx)("path", {
						d: `M${xa(0)},${Sa(0)} L${xa(1)},${Sa(1)}`,
						className: L.graphDiagonal
					}),
					/* @__PURE__ */ (0, P.jsx)("path", {
						d: `M${xa(0)},${Sa(0)} L${xa(f)},${Sa(p)} M${xa(1)},${Sa(1)} L${xa(m)},${Sa(h)}`,
						className: L.graphArm
					}),
					/* @__PURE__ */ (0, P.jsx)("path", {
						d: g,
						className: L.graphCurve
					}),
					[0, 1].map((e) => /* @__PURE__ */ (0, P.jsx)("circle", {
						cx: xa(r[e * 2]),
						cy: Sa(r[e * 2 + 1]),
						r: 6,
						className: L.graphHandle,
						"data-dragging": a === e,
						onPointerDown: (t) => {
							(t.currentTarget.ownerSVGElement ?? t.currentTarget).setPointerCapture?.(t.pointerId), o(e);
						}
					}, e))
				]
			}),
			/* @__PURE__ */ (0, P.jsx)("div", {
				className: L.bezier,
				children: r.map((e, t) => /* @__PURE__ */ (0, P.jsx)("input", {
					type: "number",
					step: .01,
					value: e,
					onChange: (e) => d(t, +e.target.value),
					"aria-label": [
						"x1",
						"y1",
						"x2",
						"y2"
					][t]
				}, t))
			}),
			/* @__PURE__ */ (0, P.jsxs)("div", {
				className: L.easingRow,
				children: [/* @__PURE__ */ (0, P.jsx)("button", {
					type: "button",
					className: L.easingPreview,
					onClick: () => c((e) => e + 1),
					title: "Replay the curve",
					children: /* @__PURE__ */ (0, P.jsx)("i", { style: {
						animationTimingFunction: ha(r),
						animationDuration: `${Ca}ms`
					} }, s)
				}), n && /* @__PURE__ */ (0, P.jsx)(Vr, { onPlay: n })]
			})
		]
	});
}
// runtime/panel-src/inspector/fonts.ts
var Ta = null, Ea = null;
function Da() {
	return Ta ? Promise.resolve(Ta) : (Ea ??= p("/__inspector/fonts").then((e) => e.json()).then((e) => Ta = e.ok ? e.fonts : []).catch(() => (Ea = null, [])), Ea);
}
function Oa(e) {
	let [t, n] = (0, E.useState)(Ta ?? []);
	return (0, E.useEffect)(() => {
		e && !Ta && Da().then(n);
	}, [e]), t;
}
var ka = (e) => Ta?.find((t) => t.family === e) ?? null;
function Aa(e) {
	return `https://fonts.googleapis.com/css2?family=${e.family.trim().replace(/ /g, "+")}${e.wght ? `:wght@${e.wght[0]}..${e.wght[1]}` : e.weights.length > 1 ? `:wght@${e.weights.join(";")}` : ""}&display=swap`;
}
function ja(e, t) {
	if (!e) return;
	let n = `design-inspector-font-${t.family.replace(/\W+/g, "-")}`;
	if (e.getElementById(n)) return;
	let r = e.createElement("link");
	r.id = n, r.rel = "stylesheet", r.href = Aa(t), e.head.appendChild(r);
}
var Ma = {
	"Sans Serif": "sans-serif",
	Serif: "serif",
	Monospace: "monospace",
	Handwriting: "cursive",
	Display: "sans-serif"
}, Na = (e) => `"${e.family}", ${Ma[e.category] ?? "sans-serif"}`, Pa = (e) => e.split(",")[0].trim().replace(/^["']|["']$/g, ""), Fa = (e) => /^\s*["']/.test(e) || /,\s*(sans-serif|serif|monospace|cursive|system-ui)\s*$/.test(e);
// runtime/panel-src/inspector/words.ts
function Ia(e) {
	let [t, n] = (0, E.useState)({}), [r, i] = (0, E.useState)({}), [a, o] = (0, E.useState)(!1);
	return (0, E.useEffect)(() => {
		D.content && p("/__inspector/words").then((e) => e.json()).then((e) => {
			o(!!e.file), n(e.words), i(e.words);
		}).catch(() => o(!1));
	}, [e]), {
		has: a,
		saved: t,
		words: r,
		set: (e, t) => i((n) => ({
			...n,
			[e]: t
		})),
		reset: () => i(t)
	};
}
var La = (e) => D.content?.labels?.[e] ?? e.replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/^./, (e) => e.toUpperCase()), Ra = [
	"All",
	"Sans Serif",
	"Serif",
	"Display",
	"Handwriting",
	"Monospace"
], za = 60;
function Ba({ value: e, onPick: t }) {
	let [n, r] = (0, E.useState)(!1), [i, a] = (0, E.useState)(""), [o, s] = (0, E.useState)("All"), c = Oa(n), l = (0, E.useRef)(null), u = Pa(e);
	(0, E.useEffect)(() => {
		if (!n) return;
		let e = (e) => {
			l.current?.contains(e.target) || r(!1);
		};
		return document.addEventListener("pointerdown", e), () => document.removeEventListener("pointerdown", e);
	}, [n]);
	let d = (0, E.useMemo)(() => {
		let e = i.trim().toLowerCase();
		return c.filter((t) => (o === "All" || t.category === o) && (!e || t.family.toLowerCase().includes(e))).slice(0, za);
	}, [
		c,
		i,
		o
	]);
	return /* @__PURE__ */ (0, P.jsxs)("div", {
		className: L.font,
		ref: l,
		children: [/* @__PURE__ */ (0, P.jsxs)("button", {
			type: "button",
			className: L.fontButton,
			onClick: () => r((e) => !e),
			"aria-expanded": n,
			children: [/* @__PURE__ */ (0, P.jsx)("span", { children: u || "Pick a font" }), /* @__PURE__ */ (0, P.jsx)("svg", {
				viewBox: "0 0 16 16",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, P.jsx)("path", { d: "m4 6 4 4 4-4" })
			})]
		}), n && /* @__PURE__ */ (0, P.jsxs)("div", {
			className: L.fontPop,
			children: [
				/* @__PURE__ */ (0, P.jsx)("input", {
					autoFocus: !0,
					placeholder: "Search Google Fonts",
					value: i,
					onChange: (e) => a(e.target.value),
					"aria-label": "Search fonts"
				}),
				/* @__PURE__ */ (0, P.jsx)("div", {
					className: L.fontKinds,
					children: Ra.map((e) => /* @__PURE__ */ (0, P.jsx)("button", {
						type: "button",
						"aria-pressed": o === e,
						onClick: () => s(e),
						children: e === "Sans Serif" ? "Sans" : e === "Handwriting" ? "Script" : e === "Monospace" ? "Mono" : e
					}, e))
				}),
				/* @__PURE__ */ (0, P.jsxs)("ul", {
					className: L.fontList,
					children: [
						!c.length && /* @__PURE__ */ (0, P.jsx)("li", {
							className: L.fontEmpty,
							children: "Loading the list…"
						}),
						c.length > 0 && !d.length && /* @__PURE__ */ (0, P.jsx)("li", {
							className: L.fontEmpty,
							children: "No family by that name"
						}),
						d.map((e) => /* @__PURE__ */ (0, P.jsx)("li", { children: /* @__PURE__ */ (0, P.jsxs)("button", {
							type: "button",
							"data-current": e.family === u,
							onPointerEnter: () => ja(document, e),
							onClick: () => {
								t(e, Na(e)), r(!1);
							},
							style: { fontFamily: `"${e.family}", ${e.category === "Serif" ? "serif" : "sans-serif"}` },
							children: [e.family, /* @__PURE__ */ (0, P.jsx)("small", { children: e.category })]
						}) }, e.family))
					]
				}),
				/* @__PURE__ */ (0, P.jsx)("p", {
					className: L.fontSource,
					children: "Google Fonts · more libraries later"
				})
			]
		})]
	});
}
// runtime/panel-src/inspector/valueCheck.ts
var Va = [
	["a colour", ["color"]],
	["a time", ["transition-delay"]],
	["an easing", ["transition-timing-function"]],
	["a size or a number", [
		"margin-left",
		"line-height",
		"font-size",
		"font-weight"
	]],
	["a number", ["opacity"]]
], Ha = /\b(var|env)\(|^(inherit|initial|unset|revert|revert-layer)$/i, Ua = (e, t) => {
	try {
		return CSS.supports(e, t);
	} catch {
		return !0;
	}
};
function Wa(e, t) {
	let n = jt(e);
	if (n) return n;
	let r = t.trim();
	if (!r || Ha.test(r)) return null;
	let i = Va.find(([, e]) => e.some((e) => Ua(e, r)));
	return !i || i[1].some((t) => Ua(t, e.trim())) ? null : `it isn't ${i[0]} (the value it replaces is one)`;
}
// runtime/panel-src/inspector/TokenControl.tsx
function Ga(e) {
	let { n: t, step: n, min: r, max: i, unit: a, onChange: o } = e;
	return /* @__PURE__ */ (0, P.jsxs)("div", {
		className: L.number,
		children: [
			/* @__PURE__ */ (0, P.jsx)("input", {
				type: "range",
				min: r,
				max: i,
				step: n,
				value: t,
				style: _r(t, r, i),
				onChange: (e) => o(+e.target.value)
			}),
			/* @__PURE__ */ (0, P.jsx)("input", {
				type: "number",
				step: n,
				value: t,
				onChange: (e) => o(+e.target.value)
			}),
			/* @__PURE__ */ (0, P.jsx)("span", { children: a })
		]
	});
}
function Ka({ name: e, meta: t, saved: n, phone: r, site: i, value: a, changed: o, onChange: s, onReset: c, scope: l, onFont: u, onPlay: d, inert: f }) {
	let p = t?.kind ?? "text", [m, h] = (0, E.useState)(!1), g = null, _ = a.trim(), v = _.match(nr), y = _.match(rr), b = _.match(ir), x = v ? null : _.match(sr), S = _.match(ar), ee = _.match(or), C = lr(_), w = lr(n) ? n : null, te = p === "color" || p === "text" ? fr(_) : null;
	if (fa(a)) g = /* @__PURE__ */ (0, P.jsx)(wa, {
		value: a,
		onChange: s,
		onPlay: d
	});
	else if (p === "text" && Fa(a)) g = /* @__PURE__ */ (0, P.jsx)(Ba, {
		value: a,
		onPick: (e, t) => {
			u?.(e), s(t);
		}
	});
	else if (te) g = /* @__PURE__ */ (0, P.jsxs)("div", {
		className: L.color,
		children: [
			/* @__PURE__ */ (0, P.jsx)("input", {
				type: "color",
				value: hr(te),
				onChange: (e) => {
					let t = fr(e.target.value);
					t && s(gr({
						...t,
						a: te.a
					}, mr(_)));
				}
			}),
			/* @__PURE__ */ (0, P.jsx)("input", {
				type: "range",
				min: 0,
				max: 1,
				step: .01,
				value: te.a,
				style: _r(te.a, 0, 1),
				onChange: (e) => s(gr({
					...te,
					a: +e.target.value
				}, mr(_))),
				"aria-label": "Opacity"
			}),
			/* @__PURE__ */ (0, P.jsxs)("span", { children: [Math.round(te.a * 100), "%"] })
		]
	});
	else if (p === "size" && v) {
		let e = +v[1], t = +(n.match(nr)?.[1] ?? e);
		g = /* @__PURE__ */ (0, P.jsx)(Ga, {
			n: e,
			step: .5,
			min: 0,
			max: Math.max(t * 3, 10),
			unit: "px",
			onChange: (e) => s(`calc(${e} * var(--u))`)
		});
	} else if (x) {
		let e = +x[1], t = x[2] ?? "";
		g = /* @__PURE__ */ (0, P.jsx)(Ga, {
			n: e,
			step: dr(t || "px", e),
			min: Math.min(0, e * 2),
			max: Math.max(Math.abs(e) * 3, 10),
			unit: t || "×",
			onChange: (e) => s(`calc(${+e.toFixed(3)}${t} * ${x[3]})`)
		});
	} else if (ee && !b) {
		let e = +ee[1];
		g = /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [/* @__PURE__ */ (0, P.jsx)(Ga, {
			n: e,
			step: .05,
			min: 0,
			max: Math.max(2, e * 3),
			unit: "s",
			onChange: (e) => s(`${+e.toFixed(3)}s`)
		}), d && /* @__PURE__ */ (0, P.jsx)(Vr, { onPlay: d })] });
	} else if (S && !(p === "em" && y)) {
		let e = +S[1], t = S[2], r = +(n.trim().match(ar)?.[1] ?? e);
		g = /* @__PURE__ */ (0, P.jsx)(Ga, {
			n: e,
			step: dr(t, e),
			min: Math.min(0, r * 2),
			max: Math.max(Math.abs(r) * 3, t === "px" ? 40 : 4),
			unit: t,
			onChange: (e) => s(`${+e.toFixed(3)}${t}`)
		});
	} else if (C && w) {
		let e = (e) => +(e.match(/-?\d*\.?\d+/)?.[0] ?? 1), t = e(C[0]) / (e(lr(w)?.[0] ?? C[0]) || 1);
		g = /* @__PURE__ */ (0, P.jsx)(Ga, {
			n: +t.toFixed(2),
			step: .05,
			min: .5,
			max: 2,
			unit: "×",
			onChange: (e) => s(ur(w, e))
		});
	} else if (p === "em" && y) g = /* @__PURE__ */ (0, P.jsx)(Ga, {
		n: +y[1],
		step: .01,
		min: -.2,
		max: .5,
		unit: "em",
		onChange: (e) => s(`${+e.toFixed(3)}em`)
	});
	else if (p === "number" && /^-?[\d.]+$/.test(a.trim())) {
		let e = +a.trim();
		g = /* @__PURE__ */ (0, P.jsx)(Ga, {
			n: e,
			step: e % 1 || Math.abs(e) < 2 ? .01 : 1,
			min: Math.min(0, e * 2),
			max: Math.max(1, e * 3),
			unit: "",
			onChange: (e) => s(String(+e.toFixed(3)))
		});
	} else p === "ms" && b && (g = /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [/* @__PURE__ */ (0, P.jsx)(Ga, {
		n: +b[1],
		step: 10,
		min: 0,
		max: Math.max(1e3, b[1] * 3),
		unit: "ms",
		onChange: (e) => s(`${e}ms`)
	}), d && /* @__PURE__ */ (0, P.jsx)(Vr, { onPlay: d })] }));
	let T = o ? Wa(a, n) : null, ne = !g || !!te || !!C || !!T, ae = ie(t, e);
	return /* @__PURE__ */ (0, P.jsxs)("div", {
		className: L.token,
		"data-changed": o,
		"data-invalid": T ? "true" : void 0,
		children: [
			/* @__PURE__ */ (0, P.jsxs)("div", {
				className: L.tokenHead,
				children: [
					(p === "color" || te) && /* @__PURE__ */ (0, P.jsx)("i", {
						className: L.swatch,
						"data-empty": T ? "true" : void 0,
						style: T ? void 0 : { background: a }
					}),
					/* @__PURE__ */ (0, P.jsx)("strong", {
						className: L.tokenName,
						children: re(e, t)
					}),
					o && /* @__PURE__ */ (0, P.jsx)("button", {
						type: "button",
						className: L.link,
						onClick: c,
						children: "reset"
					})
				]
			}),
			g,
			ne && /* @__PURE__ */ (0, P.jsx)("input", {
				className: L.raw,
				value: a,
				onChange: (e) => s(e.target.value),
				spellCheck: !1,
				"aria-label": `${re(e, t)} value`,
				"aria-invalid": T ? !0 : void 0
			}),
			T && /* @__PURE__ */ (0, P.jsxs)("p", {
				className: L.invalid,
				role: "alert",
				children: [
					"Can't be saved like this: ",
					T,
					"."
				]
			}),
			f && !T && /* @__PURE__ */ (0, P.jsx)("p", {
				className: L.phone,
				children: f === "overridden" ? `A rule ${l ? `of ${l} ` : ""}uses this value, but changing it moves nothing at this size: a later rule sets the same thing.` : `No rule ${l ? `on ${l} or inside it ` : ""}uses this value, so changing it here shows nothing (unless a script reads it).`
			}),
			i !== void 0 && /* @__PURE__ */ (0, P.jsxs)("p", {
				className: L.phone,
				children: [
					"The site's code sets this at startup (",
					i,
					"), over the tokens file: try values here, then ask Claude to change it where the code sets it."
				]
			}),
			/* @__PURE__ */ (0, P.jsx)("button", {
				type: "button",
				className: L.more,
				"aria-expanded": m,
				onClick: () => h((e) => !e),
				children: m ? "Show less" : "Show more"
			}),
			m && /* @__PURE__ */ (0, P.jsxs)("div", {
				className: L.moreBox,
				children: [
					/* @__PURE__ */ (0, P.jsxs)("p", {
						className: L.role,
						children: [/* @__PURE__ */ (0, P.jsx)("code", { children: e }), ae && /* @__PURE__ */ (0, P.jsxs)("span", { children: [" · ", ae] })]
					}),
					!ne && /* @__PURE__ */ (0, P.jsx)("input", {
						className: L.raw,
						value: a,
						onChange: (e) => s(e.target.value),
						spellCheck: !1,
						"aria-label": `${e} value`
					}),
					l && /* @__PURE__ */ (0, P.jsxs)("p", {
						className: L.phone,
						children: [
							"Changes here apply to ",
							l,
							" only. Save writes them for this layer, and the rest of the site keeps the site-wide value."
						]
					}),
					r && /* @__PURE__ */ (0, P.jsxs)("p", {
						className: L.phone,
						children: [
							"On phones: ",
							r,
							" (edits here change desktop; phones keep this value)"
						]
					})
				]
			})
		]
	});
}
// runtime/panel-src/inspector/History.tsx
var qa = {
	start: "start",
	change: "Claude",
	direct: "edit",
	pick: "pick",
	save: "saved",
	restore: "back",
	undo: "undo",
	redo: "redo",
	outside: "outside"
};
function Ja(e) {
	let t = new Date(e), n = t.toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit"
	});
	return t.toDateString() === (/* @__PURE__ */ new Date()).toDateString() ? n : `${t.toLocaleDateString([], {
		day: "numeric",
		month: "short"
	})}, ${n}`;
}
var Ya = (e) => {
	let t = e.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
	return t.length > 64 ? `${t.slice(0, 63)}…` : t;
};
function Xa({ version: e, onRestored: t }) {
	let [n, r] = (0, E.useState)(null), [i, a] = (0, E.useState)(null), [o, s] = (0, E.useState)(null), [c, l] = (0, E.useState)(null), [u, d] = (0, E.useState)(!1), [f, m] = (0, E.useState)(0);
	(0, E.useEffect)(() => {
		p("/__inspector/history").then((e) => e.json()).then((e) => r(e.entries)).catch(() => l("Can't reach the dev server"));
	}, [e, f]);
	let h = async (e, n, r, i) => {
		s(e), l(null);
		try {
			at();
			let e = await (await p(n, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(r)
			})).json();
			if (!e.ok) throw Error(e.error);
			m((e) => e + 1), t();
		} catch (e) {
			l(e instanceof Error ? e.message : i);
		} finally {
			s(null);
		}
	}, g = (e) => h(e, "/__inspector/restore", { id: e }, "Couldn't go back"), _ = (e) => h(e, "/__inspector/undo-edit", { entry: e }, "Couldn't take it back");
	if (!n) return /* @__PURE__ */ (0, P.jsx)("p", {
		className: L.empty,
		children: c ?? "Loading history…"
	});
	let v = n.reduce((e, t) => e + (t.usage ? t.usage.input + t.usage.output : 0), 0), y = n.filter((e, t) => t === 0 || u || e.point), b = (e) => {
		let t = n.indexOf(e), r = y[y.indexOf(e) - 1];
		return r ? t - n.indexOf(r) - 1 : 0;
	};
	return /* @__PURE__ */ (0, P.jsxs)("section", {
		className: L.history,
		children: [
			/* @__PURE__ */ (0, P.jsxs)("p", {
				className: L.phone,
				children: [
					u ? `${n.length} versions` : `${y.length - 1} ${y.length === 2 ? "point" : "points"} to go back to`,
					" · ",
					v.toLocaleString(),
					" tokens spent on changes. Going back adds a new version, so you can always come back.",
					" ",
					/* @__PURE__ */ (0, P.jsx)("button", {
						type: "button",
						className: L.link,
						"aria-pressed": u,
						onClick: () => d((e) => !e),
						children: u ? "Points only" : `Every step (${n.length})`
					})
				]
			}),
			c && /* @__PURE__ */ (0, P.jsx)("p", {
				className: L.error,
				children: c
			}),
			/* @__PURE__ */ (0, P.jsx)("ol", { children: y.map((e, t) => /* @__PURE__ */ (0, P.jsxs)("li", {
				className: L.version,
				"data-current": t === 0,
				"data-point": !!e.point,
				children: [
					/* @__PURE__ */ (0, P.jsxs)("button", {
						type: "button",
						className: L.versionHead,
						onClick: () => a(i === e.id ? null : e.id),
						children: [
							/* @__PURE__ */ (0, P.jsx)("span", {
								className: L.badge,
								"data-kind": e.kind,
								children: !u && e.point && t > 0 ? "point" : qa[e.kind]
							}),
							/* @__PURE__ */ (0, P.jsxs)("span", {
								className: L.versionLabel,
								"data-undone": !!e.undone,
								children: [!u && t > 0 && e.point && e.kind !== "save" && e.kind !== "start" ? e.point : Ya(e.label), e.undone ? " (not in the page now)" : ""]
							}),
							/* @__PURE__ */ (0, P.jsx)("time", { children: Ja(e.time) })
						]
					}),
					i === e.id && /* @__PURE__ */ (0, P.jsxs)("div", {
						className: L.versionBody,
						children: [
							e.point && /* @__PURE__ */ (0, P.jsx)("p", { children: u || e.kind === "save" || e.kind === "start" ? e.point : Ya(e.label) }),
							!u && b(e) > 0 && /* @__PURE__ */ (0, P.jsxs)("p", {
								className: L.phone,
								children: [
									b(e),
									" more ",
									b(e) === 1 ? "version" : "versions",
									" between this and the one above."
								]
							}),
							e.summary && /* @__PURE__ */ (0, P.jsx)("p", { children: e.summary }),
							e.files.length > 0 && /* @__PURE__ */ (0, P.jsx)("p", {
								className: L.phone,
								children: e.files.join(", ")
							}),
							e.usage && /* @__PURE__ */ (0, P.jsxs)("p", {
								className: L.phone,
								children: [
									e.mode === "project" ? "Whole project" : "This part",
									" · ",
									e.usage.input.toLocaleString(),
									" in / ",
									e.usage.output.toLocaleString(),
									" out"
								]
							})
						]
					}),
					t === 0 ? /* @__PURE__ */ (0, P.jsx)("span", {
						className: L.now,
						children: "now"
					}) : /* @__PURE__ */ (0, P.jsxs)("span", {
						className: L.versionActions,
						children: [u && e.kind === "direct" && !e.undone && /* @__PURE__ */ (0, P.jsx)("button", {
							type: "button",
							className: L.ghost,
							disabled: !!o,
							title: "Take back this one edit; everything made since stays",
							onClick: () => void _(e.id),
							children: o === e.id ? "…" : "Undo"
						}), /* @__PURE__ */ (0, P.jsx)("button", {
							type: "button",
							className: L.ghost,
							disabled: !!o,
							title: "Put the whole site back as it was here",
							onClick: () => void g(e.id),
							children: o === e.id ? "Going back…" : "Go back here"
						})]
					})
				]
			}, e.id)) })
		]
	});
}
// runtime/panel-src/inspector/Assets.tsx
var Za = /\.(png|jpe?g|webp|avif|gif|svg|bmp|ico)$/i, Qa = /\.(mp4|webm|mov|m4v|ogv)$/i, $a = 6e3, eo = [1500, 5e3], to = (e) => [...e.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)].map((e) => e[2]);
function no(e) {
	let t = e.defaultView;
	if (!t || !e.body) return [];
	let n = /* @__PURE__ */ new Map(), r = (r, i, a) => {
		if (!r || /^(data|blob|about|javascript):/i.test(r.trim())) return;
		let o;
		try {
			o = new URL(r, e.baseURI);
		} catch {
			return;
		}
		if (o.origin === t.location.origin && o.pathname.startsWith("/__inspector")) return;
		let s = o.href, c = n.get(s);
		c || (c = {
			url: s,
			path: o.origin === t.location.origin ? decodeURIComponent(o.pathname) : o.href,
			name: decodeURIComponent(o.pathname.split("/").pop() || o.hostname),
			video: a,
			els: []
		}, n.set(s, c)), i && !c.els.includes(i) && c.els.push(i);
	};
	for (let t of e.querySelectorAll("img")) r(t.currentSrc || t.getAttribute("src"), t, !1);
	for (let t of e.querySelectorAll("video")) r(t.currentSrc || t.getAttribute("src") || t.querySelector("source")?.getAttribute("src"), t, !0), r(t.getAttribute("poster"), t, !1);
	for (let t of e.querySelectorAll("image")) r(t.getAttribute("href") ?? t.getAttribute("xlink:href"), t, !1);
	let i = e.body.getElementsByTagName("*");
	for (let e = 0; e < i.length && e < $a; e++) {
		let n = t.getComputedStyle(i[e]).backgroundImage;
		if (n && n !== "none" && n.includes("url(")) for (let t of to(n)) r(t, i[e], !1);
	}
	for (let e of t.performance.getEntriesByType("resource")) {
		let t;
		try {
			t = new URL(e.name).pathname;
		} catch {
			continue;
		}
		Za.test(t) ? r(e.name, null, !1) : Qa.test(t) && r(e.name, null, !0);
	}
	let a = [...n.values()].filter((e) => e.els.length);
	return a.sort((e, t) => e.els[0].compareDocumentPosition(t.els[0]) & 4 ? -1 : 1), [...a, ...[...n.values()].filter((e) => !e.els.length)];
}
var ro = (e) => {
	if (!e.els.length) return "Used by the site's code";
	let t = j(tn(Qt(e.els[0]))), n = e.els.length > 1 ? ` · ${e.els.length} places` : "";
	return `${t?.label ?? "On the page"}${n}`;
};
function io({ doc: e, version: t, loads: n, selectedEls: r, onPick: i }) {
	let [a, o] = (0, E.useState)(null), [s, c] = (0, E.useState)(""), [l, u] = (0, E.useState)(0);
	(0, E.useEffect)(() => {
		if (!e) return;
		o(no(e));
		let t = e.defaultView, n = eo.map((n) => t?.setTimeout(() => o(no(e)), n));
		return () => n.forEach((e) => e !== void 0 && t?.clearTimeout(e));
	}, [
		e,
		t,
		n,
		l
	]);
	let d = (0, E.useMemo)(() => {
		let e = s.trim().toLowerCase();
		return (a ?? []).filter((t) => !e || t.path.toLowerCase().includes(e) || ro(t).toLowerCase().includes(e));
	}, [a, s]);
	return !e || !a ? /* @__PURE__ */ (0, P.jsx)("p", {
		className: L.empty,
		children: "Loading the page…"
	}) : /* @__PURE__ */ (0, P.jsxs)("section", {
		className: L.assets,
		children: [
			/* @__PURE__ */ (0, P.jsx)("input", {
				type: "search",
				className: L.assetSearch,
				value: s,
				onChange: (e) => c(e.target.value),
				placeholder: "Find an asset…",
				"aria-label": "Find an asset",
				spellCheck: !1
			}),
			/* @__PURE__ */ (0, P.jsxs)("p", {
				className: L.phone,
				children: [
					a.length,
					" ",
					a.length === 1 ? "picture or video" : "pictures and videos",
					" on this page.",
					" ",
					/* @__PURE__ */ (0, P.jsx)("button", {
						type: "button",
						className: L.link,
						onClick: () => u((e) => e + 1),
						children: "Read again"
					})
				]
			}),
			d.length === 0 ? /* @__PURE__ */ (0, P.jsx)("p", {
				className: L.empty,
				children: a.length ? "Nothing matches." : "This page shows no pictures or videos."
			}) : /* @__PURE__ */ (0, P.jsx)("ul", { children: d.map((e) => {
				let t = e.els.length > 0, n = e.els.some((e) => r.includes(e));
				return /* @__PURE__ */ (0, P.jsx)("li", { children: /* @__PURE__ */ (0, P.jsxs)("button", {
					type: "button",
					className: L.asset,
					"data-picked": n,
					disabled: !t,
					title: t ? `${e.path}\nPick it on the page` : `${e.path}\nThe site's code loads it (a canvas or WebGL scene, say): it isn't on the page to pick`,
					onClick: () => t && i(e.els[0]),
					children: [e.video ? /* @__PURE__ */ (0, P.jsx)("video", {
						src: e.url,
						muted: !0,
						preload: "metadata"
					}) : /* @__PURE__ */ (0, P.jsx)("img", {
						src: e.url,
						alt: "",
						loading: "lazy"
					}), /* @__PURE__ */ (0, P.jsxs)("span", { children: [/* @__PURE__ */ (0, P.jsx)("strong", { children: e.name }), /* @__PURE__ */ (0, P.jsx)("small", { children: ro(e) })] })]
				}) }, e.url);
			}) })
		]
	});
}
// runtime/panel-src/inspector/About.tsx
var ao = {
	website: "https://uberdesigner.ai",
	templates: "https://uberdesigner.ai/library?utm_source=uberdesigner-skill&utm_medium=skill&utm_campaign=about-card",
	x: "https://x.com/uberdesigner_ai",
	github: "https://github.com/bogdan239/uberdesigner-studio",
	discord: "https://discord.gg/CuyTccfBg3"
}, oo = {
	x: "M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l8.2-9.4L.8 2h6.5l4.4 6.7L18.9 2Zm-1.1 18h1.7L6.4 3.9H4.6L17.8 20Z",
	github: "M12 1.4a10.8 10.8 0 0 0-3.4 21.1c.5.1.7-.2.7-.5v-2.1c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.2-1.5-1.2-1.5-1-.7.1-.7.1-.7 1.1.1 1.7 1.1 1.7 1.1 1 1.7 2.6 1.2 3.2.9.1-.7.4-1.2.7-1.5-2.3-.3-4.7-1.2-4.7-5.3 0-1.2.4-2.1 1.1-2.9-.1-.3-.5-1.4.1-2.9 0 0 .9-.3 3 1.1a10.4 10.4 0 0 1 5.5 0c2.1-1.4 3-1.1 3-1.1.6 1.5.2 2.6.1 2.9.7.8 1.1 1.7 1.1 2.9 0 4.1-2.5 5-4.8 5.3.4.3.7 1 .7 2v3c0 .3.2.6.7.5A10.8 10.8 0 0 0 12 1.4Z",
	discord: "M19.7 4.5a18 18 0 0 0-4.4-1.4l-.5 1a16.4 16.4 0 0 0-5.6 0l-.5-1a18 18 0 0 0-4.4 1.4C1.5 8.7.7 12.7 1.1 16.7a18 18 0 0 0 5.4 2.7l1.1-1.8-1.7-.8.4-.3a13 13 0 0 0 11.4 0l.4.3-1.7.8 1.1 1.8a18 18 0 0 0 5.4-2.7c.5-4.6-.8-8.6-3.2-12.2ZM8.6 14.3c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.8 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z"
}, so = "M23.9192 12.0006C23.9192 15.2466 22.6201 18.1893 20.5149 20.3383V13.9434C19.5375 14.626 18.3854 15.1914 17.1089 15.6063V22.7693C16.0506 23.272 14.9067 23.6242 13.7047 23.796V16.3085C13.1493 16.3628 12.5817 16.3922 12.0044 16.3923C11.4264 16.3923 10.8564 16.3629 10.3005 16.3085V23.796C9.09865 23.624 7.95431 23.2722 6.8963 22.7693V15.6063C5.62038 15.1915 4.46911 14.6258 3.49195 13.9434V20.3383C1.38689 18.1893 0.0877876 15.2466 0.0877876 12.0006C0.0881538 5.53647 5.23711 0.274989 11.6568 0.091173C11.772 0.0888332 11.8884 0.0876083 12.0044 0.0876083C12.1206 0.087614 12.2365 0.0888126 12.3519 0.091173C18.7712 0.275507 23.9188 5.53679 23.9192 12.0006Z";
function co({ id: e, title: t, note: n }) {
	let r = /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [/* @__PURE__ */ (0, P.jsxs)("span", {
		className: N.aboutTileTop,
		children: [/* @__PURE__ */ (0, P.jsx)("svg", {
			viewBox: "0 0 24 24",
			"aria-hidden": "true",
			children: /* @__PURE__ */ (0, P.jsx)("path", { d: oo[e] })
		}), /* @__PURE__ */ (0, P.jsx)("span", {
			className: N.aboutArrow,
			"aria-hidden": "true",
			children: "↗"
		})]
	}), /* @__PURE__ */ (0, P.jsxs)("span", { children: [/* @__PURE__ */ (0, P.jsx)("strong", { children: t }), /* @__PURE__ */ (0, P.jsx)("small", { children: n })] })] });
	return ao[e] ? /* @__PURE__ */ (0, P.jsx)("a", {
		className: N.aboutTile,
		href: ao[e],
		target: "_blank",
		rel: "noopener noreferrer",
		children: r
	}) : /* @__PURE__ */ (0, P.jsx)("div", {
		className: N.aboutTile,
		"data-pending": "true",
		role: "link",
		"aria-disabled": "true",
		"aria-label": `${t}: not available yet`,
		children: r
	});
}
function lo({ onClose: e }) {
	let t = (0, E.useRef)(null);
	return (0, E.useEffect)(() => {
		let n = (t) => {
			t.key === "Escape" && (t.stopPropagation(), e());
		};
		return window.addEventListener("keydown", n, !0), t.current?.querySelector("button")?.focus(), () => window.removeEventListener("keydown", n, !0);
	}, [e]), /* @__PURE__ */ (0, P.jsx)("div", {
		className: N.aboutBack,
		onClick: e,
		children: /* @__PURE__ */ (0, P.jsxs)("div", {
			ref: t,
			className: N.about,
			role: "dialog",
			"aria-modal": "true",
			"aria-labelledby": "uberdesigner-about-title",
			onClick: (e) => e.stopPropagation(),
			children: [
				/* @__PURE__ */ (0, P.jsx)("button", {
					type: "button",
					className: N.aboutClose,
					onClick: e,
					"aria-label": "Close",
					children: /* @__PURE__ */ (0, P.jsx)("svg", {
						viewBox: "0 0 24 24",
						"aria-hidden": "true",
						children: /* @__PURE__ */ (0, P.jsx)("path", { d: "m6 6 12 12M6 18 18 6" })
					})
				}),
				/* @__PURE__ */ (0, P.jsxs)("a", {
					className: N.aboutWordmark,
					href: ao.website,
					target: "_blank",
					rel: "noopener noreferrer",
					"aria-label": "uberdesigner website",
					children: [/* @__PURE__ */ (0, P.jsx)("svg", {
						viewBox: "0 0 24 24",
						"aria-hidden": "true",
						children: /* @__PURE__ */ (0, P.jsx)("path", { d: so })
					}), /* @__PURE__ */ (0, P.jsx)("span", { children: "uberdesigner" })]
				}),
				/* @__PURE__ */ (0, P.jsxs)("div", {
					className: N.aboutIntro,
					children: [/* @__PURE__ */ (0, P.jsx)("h2", {
						id: "uberdesigner-about-title",
						children: "Slop Ends Here."
					}), /* @__PURE__ */ (0, P.jsx)("p", { children: "Templates, tools and people to build with." })]
				}),
				/* @__PURE__ */ (0, P.jsxs)("a", {
					className: N.aboutTemplates,
					href: ao.templates,
					target: "_blank",
					rel: "noopener noreferrer",
					children: [
						/* @__PURE__ */ (0, P.jsxs)("span", {
							className: N.aboutTemplatesIcon,
							"aria-hidden": "true",
							children: [
								/* @__PURE__ */ (0, P.jsx)("i", {}),
								/* @__PURE__ */ (0, P.jsx)("i", {}),
								/* @__PURE__ */ (0, P.jsx)("i", {})
							]
						}),
						/* @__PURE__ */ (0, P.jsxs)("span", { children: [/* @__PURE__ */ (0, P.jsx)("strong", { children: "Explore Templates" }), /* @__PURE__ */ (0, P.jsx)("small", { children: "A better starting point for your next website." })] }),
						/* @__PURE__ */ (0, P.jsx)("span", {
							className: N.aboutTemplatesArrow,
							"aria-hidden": "true",
							children: "↗"
						})
					]
				}),
				/* @__PURE__ */ (0, P.jsxs)("div", {
					className: N.aboutSocials,
					children: [
						/* @__PURE__ */ (0, P.jsx)(co, {
							id: "x",
							title: "Follow on X",
							note: "Follow what’s next"
						}),
						/* @__PURE__ */ (0, P.jsx)(co, {
							id: "github",
							title: "GitHub",
							note: "Explore the project"
						}),
						/* @__PURE__ */ (0, P.jsx)(co, {
							id: "discord",
							title: "Join Discord",
							note: "Meet the community"
						})
					]
				})
			]
		})
	});
}
// runtime/panel-src/inspector/pages.ts
var uo = 200, fo = 40, po = {
	path: "/",
	label: "Home",
	named: !0
}, mo = /\.(?!html?$)[a-z0-9]{1,5}$/i, ho = (e) => e.pathname.replace(/\/index\.html?$/i, "/") + e.search;
function go(e) {
	let t = e.split("?")[0].replace(/\/+$/, "").split("/").pop() ?? "", n = decodeURIComponent(t).replace(/\.html?$/i, "").replace(/[-_]+/g, " ").trim();
	return n ? n[0].toUpperCase() + n.slice(1) : "Home";
}
function _o(e) {
	let t = e.defaultView;
	if (!t) return [];
	let n = t.location.origin, r = /* @__PURE__ */ new Map(), i = ho(new URL(t.location.href));
	r.set("/", po), i !== "/" && r.set(i, {
		path: i,
		label: go(i),
		named: !1
	});
	for (let t of e.querySelectorAll("a[href]")) {
		if (r.size >= uo) break;
		let a;
		try {
			a = new URL(t.getAttribute("href") ?? "", e.baseURI);
		} catch {
			continue;
		}
		if (a.origin !== n || !/^https?:$/.test(a.protocol) || a.pathname.startsWith("/__inspector") || mo.test(a.pathname) || t.hasAttribute("download")) continue;
		let o = ho(a);
		if (o === i || o === "/") continue;
		let s = (t.textContent ?? "").replace(/\s+/g, " ").trim(), c = s.length > 0 && s.length <= fo, l = r.get(o);
		l ? !l.named && c && r.set(o, {
			path: o,
			label: s,
			named: c
		}) : r.set(o, {
			path: o,
			label: c ? s : go(o),
			named: c
		});
	}
	return [...r.values()];
}
function vo(e, t) {
	let n = new Map(e.map((e) => [e.path, e]));
	for (let e of _o(t)) {
		let t = n.get(e.path);
		(!t || !t.named && e.named) && n.set(e.path, t ? {
			...t,
			label: e.label,
			named: !0
		} : e);
	}
	let r = [...n.values()].slice(0, uo), i = r.findIndex((e) => e.path === "/");
	return i > 0 && r.unshift(...r.splice(i, 1)), r;
}
// runtime/panel-src/inspector/shield.ts
var yo = [
	"keydown",
	"keyup",
	"keypress",
	"wheel",
	"touchstart",
	"touchmove",
	"touchend"
];
function bo(e, t, n) {
	let r = (0, E.useRef)(n);
	r.current = n, (0, E.useEffect)(() => {
		let n = e.current;
		if (!t || !n) return;
		let i = (e) => {
			e.stopPropagation(), e instanceof KeyboardEvent && e.type === "keydown" && e.key === "Escape" && (e.target.closest("input, textarea, [contenteditable]") || r.current?.());
		};
		return yo.forEach((e) => n.addEventListener(e, i)), () => yo.forEach((e) => n.removeEventListener(e, i));
	}, [e, t]);
}
// runtime/panel-src/inspector/numbers.ts
var xo = `design-inspector:card-numbers:${D.name}`, So = 400;
function Co() {
	try {
		let e = JSON.parse(localStorage.getItem(xo) ?? "null");
		if (e && typeof e.next == "number" && e.ids && typeof e.ids == "object") return e;
	} catch {}
	return {
		next: 1,
		ids: {}
	};
}
var wo = Co();
function To(e) {
	let t = e.filter((e) => !(e.id in wo.ids));
	if (t.length) {
		wo = Co();
		let e = t.filter((e) => !(e.id in wo.ids)).sort((e, t) => (e.tries[0]?.queuedAt ?? 0) - (t.tries[0]?.queuedAt ?? 0));
		for (let t of e) wo.ids[t.id] = wo.next++;
		if (e.length) {
			let e = Object.entries(wo.ids);
			e.length > So && (wo.ids = Object.fromEntries(e.sort((e, t) => e[1] - t[1]).slice(-400)));
			try {
				localStorage.setItem(xo, JSON.stringify(wo));
			} catch {}
		}
	}
	return new Map(e.map((e) => [e.id, wo.ids[e.id]]));
}
// runtime/panel-src/inspector/Activity.tsx
var Eo = 3, Do = "design-inspector:seen-cards", Oo = (() => {
	try {
		return new Set(JSON.parse(sessionStorage.getItem(Do) ?? "[]"));
	} catch {
		return /* @__PURE__ */ new Set();
	}
})(), ko = (e) => {
	if (Oo.has(e)) return !1;
	Oo.add(e);
	try {
		sessionStorage.setItem(Do, JSON.stringify([...Oo].slice(-60)));
	} catch {}
	return !0;
};
function Ao({ jobs: e, side: t, place: n = "corner", only: r = "active", onOpen: i }) {
	let a = r === "resolved" ? [] : e.threads.filter((e) => !e.resolved), o = n === "side" && r === "resolved" ? e.threads.filter((e) => e.resolved) : [], [s, c] = (0, E.useState)(!1), l = I(a.some((e) => e.active)), u = (0, E.useRef)(null);
	bo(u, a.length + o.length > 0);
	let d = To(e.threads);
	if (!a.length && !o.length) return null;
	let f = n === "corner" && a.length > Eo, p = s || !f ? a : a.slice(0, Eo), m = a.filter((e) => !e.active && !e.changed);
	return /* @__PURE__ */ (0, P.jsxs)("div", {
		ref: u,
		className: L.cards,
		"data-side": t,
		"data-place": n,
		"aria-live": "polite",
		children: [
			p.map((t) => /* @__PURE__ */ (0, P.jsx)(No, {
				thread: t,
				number: d.get(t.id),
				now: l,
				jobs: e,
				onOpen: i
			}, t.id)),
			(f || m.length > 1) && /* @__PURE__ */ (0, P.jsxs)("div", {
				className: L.cardsFoot,
				children: [f && /* @__PURE__ */ (0, P.jsx)("button", {
					type: "button",
					onClick: () => c((e) => !e),
					children: s ? "Show fewer" : `${a.length - Eo} more`
				}), m.length > 1 && /* @__PURE__ */ (0, P.jsx)("button", {
					type: "button",
					onClick: () => m.forEach((t) => void e.dismiss(t.id)),
					children: "Clear the rest"
				})]
			}),
			o.map((t) => /* @__PURE__ */ (0, P.jsx)(No, {
				thread: t,
				number: d.get(t.id),
				now: l,
				jobs: e,
				onOpen: i
			}, t.id))
		]
	});
}
var jo = (e) => {
	let t = e.latest;
	return t.state === "queued" ? "queued" : t.state === "running" ? "running" : e.undone ? "undone" : e.changed ? e.kept ? "kept" : "review" : t.stopped ? "stopped" : t.state === "error" ? "failed" : t.needs ? "needs" : "nothing";
}, Mo = {
	queued: "Queued",
	running: "Changing",
	review: "Changed",
	kept: "Kept",
	needs: "Needs your OK",
	nothing: "No change",
	failed: "Didn't work",
	stopped: "Stopped",
	undone: "Not in the page now"
};
function No({ thread: e, number: t, now: n, jobs: r, onOpen: i }) {
	let a = e.latest, o = jo(e), [s] = (0, E.useState)(() => ko(e.id)), [c, l] = (0, E.useState)(null), [u, d] = (0, E.useState)(null), [f, p] = (0, E.useState)(""), m = a.mode === "project" ? "site" : a.partId ?? null, [h, g] = (0, E.useState)(null), _ = e.tries.filter(Qe).reduce((e, t) => Math.max(e, t.try), 0), v = !Ze(a) && a.undone && _ > 0 ? _ : a.try, y = h ?? v, b = y === 0 || y === a.try ? null : e.tries.find((e) => e.try === y) ?? null, x = r.comparing?.thread === e.id, S = (e, t) => async () => {
		d(e), l(null);
		try {
			await t();
		} catch (e) {
			l(e instanceof Error ? e.message : String(e));
		} finally {
			d(null);
		}
	}, ee = (t) => void S("step", async () => {
		g(t === v ? null : t);
		let n = e.tries.find((e) => e.try === t);
		t >= _ || n?.undone ? await r.compare(e.id, "after") : await r.compare(e.id, t);
	})(), C = S("refine", async () => {
		f.trim() && (await r.refine(e.id, f.trim()), p(""));
	}), w = y === 0 ? "The part as it was before this change." : b ? b.undone ? `Taken back. ${b.summary ?? b.error ?? ""}` : b.error && !Qe(b) ? `Didn't change anything: ${b.error}` : b.summary ?? "" : null, te = Ze(a) ? null : a.error && !Qe(a) ? e.changed ? `Try ${a.try} didn't change anything: ${a.error}` : a.error : o === "needs" ? a.needs?.why ?? a.summary : !Qe(a) && e.changed ? `Try ${a.try} didn't change anything: ${a.summary || "no edits"}` : a.summary, T = w ?? te, ne = e.tries.reduce((e, t) => e + (t.usage ? t.usage.weighted ?? t.usage.input + t.usage.output : 0), 0), re = e.tries.reduce((e, t) => e + (t.saved ?? 0), 0), ie = e.tries.length > 1 ? ` · ${e.tries.length} tries` : "", ae = y === 0 ? "Original" : (b ?? a).request, oe = !Ze(a) && (e.changed || e.tries.some((e) => e.undone)), se = y < _, ce = !Ze(a);
	return /* @__PURE__ */ (0, P.jsxs)("article", {
		className: L.card,
		"data-thread": e.id,
		"data-number": t,
		"data-kind": o,
		"data-fresh": s,
		"data-ready": ce,
		onClick: ce ? (e) => {
			e.target.closest("button, a, input, textarea, select, label, [contenteditable]") || window.getSelection()?.toString() || i(m);
		} : void 0,
		title: ce ? a.mode === "project" ? "Open Whole site in the panel" : `Show ${a.part} on the page` : void 0,
		children: [
			/* @__PURE__ */ (0, P.jsxs)("div", {
				className: L.cardTop,
				children: [
					/* @__PURE__ */ (0, P.jsx)(Po, { kind: o }),
					/* @__PURE__ */ (0, P.jsxs)("div", {
						className: L.cardWhat,
						children: [
							/* @__PURE__ */ (0, P.jsxs)("div", {
								className: L.cardMeta,
								children: [/* @__PURE__ */ (0, P.jsxs)("span", {
									className: L.cardKind,
									children: [x ? r.comparing?.upTo ? `Showing try ${r.comparing.upTo}` : "Showing original" : Mo[o], ie]
								}), /* @__PURE__ */ (0, P.jsx)("span", { children: a.state === "running" ? gt(n - a.started) : a.state === "queued" ? "waiting" : a.finished ? `took ${gt(a.finished - a.started)}` : "" })]
							}),
							/* @__PURE__ */ (0, P.jsxs)("button", {
								type: "button",
								className: L.cardPart,
								onClick: () => i(m),
								title: "Open this part in the panel",
								children: [t !== void 0 && /* @__PURE__ */ (0, P.jsx)("span", {
									className: L.pin,
									"data-on": "card",
									"aria-label": `Change ${t}`,
									children: t
								}), a.mode === "project" ? "Whole site" : a.part]
							}),
							/* @__PURE__ */ (0, P.jsx)("p", {
								className: L.cardAsk,
								children: ae
							})
						]
					}),
					Ze(a) ? /* @__PURE__ */ (0, P.jsx)("button", {
						type: "button",
						className: L.cardX,
						onClick: S("stop", () => r.stop(a.id)),
						disabled: !!u || a.stopped,
						"aria-label": a.state === "queued" ? "Cancel" : "Stop",
						title: a.state === "queued" ? "Cancel" : "Stop",
						children: "■"
					}) : !e.changed && !e.resolved && /* @__PURE__ */ (0, P.jsx)("button", {
						type: "button",
						className: L.cardX,
						onClick: S("close", () => r.dismiss(e.id)),
						"aria-label": "Close",
						title: "Close",
						children: "✕"
					})
				]
			}),
			Ze(a) && /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [/* @__PURE__ */ (0, P.jsx)("div", {
				className: L.bar,
				children: /* @__PURE__ */ (0, P.jsx)("span", {
					style: { transform: `scaleX(${mt(a, n)})` },
					"data-waiting": a.state === "queued"
				})
			}), /* @__PURE__ */ (0, P.jsxs)("p", {
				className: L.cardStep,
				children: [/* @__PURE__ */ (0, P.jsx)("span", { children: a.stopped ? "Stopping…" : ft(a) }), /* @__PURE__ */ (0, P.jsx)("span", { children: a.state === "running" ? ht(a, n) : "" })]
			})] }),
			T && /* @__PURE__ */ (0, P.jsx)("p", {
				className: L.cardText,
				children: T
			}),
			(b ?? a).observed?.note && !(b ?? a).undone && y !== 0 && /* @__PURE__ */ (0, P.jsx)("p", {
				className: L.note,
				children: (b ?? a).observed?.note
			}),
			c && /* @__PURE__ */ (0, P.jsx)("p", {
				className: L.cardError,
				children: c
			}),
			oe && /* @__PURE__ */ (0, P.jsxs)("div", {
				className: L.cardCompare,
				children: [
					/* @__PURE__ */ (0, P.jsxs)("div", {
						className: L.stepper,
						"aria-label": "Tries of this change",
						children: [
							/* @__PURE__ */ (0, P.jsx)("button", {
								type: "button",
								disabled: y <= 0 || !!u,
								onClick: () => ee(y - 1),
								"aria-label": "Previous",
								children: "‹"
							}),
							/* @__PURE__ */ (0, P.jsxs)("span", { children: [y === 0 ? "Original" : `Try ${y} of ${e.tries.length}`, b?.undone ? " · taken back" : ""] }),
							/* @__PURE__ */ (0, P.jsx)("button", {
								type: "button",
								disabled: y >= a.try || !!u,
								onClick: () => ee(y + 1),
								"aria-label": "Next",
								children: "›"
							})
						]
					}),
					se && !b?.undone && /* @__PURE__ */ (0, P.jsx)("button", {
						type: "button",
						className: L.useThis,
						disabled: !!u,
						onClick: S("choose", async () => {
							await r.choose(e.id, y), g(null);
						}),
						title: "Go back to this state: the tries after it are taken back, and you can keep refining from here",
						children: u === "choose" ? "…" : "Use this one"
					}),
					/* @__PURE__ */ (0, P.jsxs)("span", {
						className: L.cardCost,
						children: [
							vt(ne),
							" tokens",
							re > 0 ? ` · saved ~${vt(re)}` : ""
						]
					})
				]
			}),
			!Ze(a) && /* @__PURE__ */ (0, P.jsxs)("form", {
				className: L.cardMore,
				onSubmit: (e) => {
					e.preventDefault(), C();
				},
				children: [/* @__PURE__ */ (0, P.jsx)("input", {
					value: f,
					onChange: (e) => p(e.target.value),
					placeholder: se ? "Use this one first, then refine from it" : e.changed ? "Not quite? Say what to change…" : "Try again: say it differently…",
					"aria-label": "Refine this change"
				}), /* @__PURE__ */ (0, P.jsx)("button", {
					type: "submit",
					disabled: !f.trim() || !!u || se,
					children: u === "refine" ? "…" : "Send"
				})]
			}),
			!Ze(a) && (e.changed || o === "needs" || o === "undone") && /* @__PURE__ */ (0, P.jsxs)("div", {
				className: L.cardActions,
				children: [
					o === "undone" && /* @__PURE__ */ (0, P.jsx)("button", {
						type: "button",
						className: L.cardKeep,
						disabled: !!u,
						title: "Put this change back on the site as it is now. Everything made since stays.",
						onClick: S("back", () => r.bringBack(e.id)),
						children: u === "back" ? "Bringing back…" : "Bring back"
					}),
					o === "needs" && /* @__PURE__ */ (0, P.jsx)("button", {
						type: "button",
						onClick: () => i(m),
						children: "Open"
					}),
					e.changed && /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [/* @__PURE__ */ (0, P.jsx)("button", {
						type: "button",
						disabled: !!u,
						onClick: S("undo", () => r.undo(e.id)),
						children: u === "undo" ? "Undoing…" : "Undo"
					}), !e.kept && /* @__PURE__ */ (0, P.jsx)("button", {
						type: "button",
						className: L.cardKeep,
						disabled: !!u,
						onClick: S("keep", () => r.keep(e.id)),
						children: "Keep"
					})] })
				]
			})
		]
	});
}
function Po({ kind: e }) {
	return /* @__PURE__ */ (0, P.jsx)("span", {
		className: L.glyph,
		"data-kind": e,
		"aria-hidden": "true",
		children: /* @__PURE__ */ (0, P.jsxs)("svg", {
			viewBox: "0 0 28 28",
			width: "28",
			height: "28",
			children: [
				e === "running" && /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [
					/* @__PURE__ */ (0, P.jsx)("circle", {
						className: L.glyphTrack,
						cx: "14",
						cy: "14",
						r: "9"
					}),
					/* @__PURE__ */ (0, P.jsx)("circle", {
						className: L.glyphSpin,
						cx: "14",
						cy: "14",
						r: "9"
					}),
					/* @__PURE__ */ (0, P.jsx)("circle", {
						className: L.glyphCore,
						cx: "14",
						cy: "14",
						r: "3"
					})
				] }),
				e === "queued" && [
					8,
					14,
					20
				].map((e, t) => /* @__PURE__ */ (0, P.jsx)("circle", {
					className: L.glyphDot,
					style: { animationDelay: `${t * .18}s` },
					cx: e,
					cy: "14",
					r: "2.2"
				}, e)),
				(e === "review" || e === "kept") && /* @__PURE__ */ (0, P.jsx)("path", {
					className: L.glyphCheck,
					d: "M8 14.5l4 4 8-9"
				}),
				(e === "needs" || e === "failed") && /* @__PURE__ */ (0, P.jsx)("path", {
					className: L.glyphMark,
					d: "M14 8v7M14 19.5v.5"
				}),
				(e === "nothing" || e === "stopped" || e === "undone") && /* @__PURE__ */ (0, P.jsx)("path", {
					className: L.glyphMark,
					d: e === "undone" ? "M10 11h7a4 4 0 010 8h-5M10 11l3-3M10 11l3 3" : "M9 14h10"
				})
			]
		})
	});
}
// runtime/panel-src/inspector/names.ts
function Fo(e) {
	let t = e.split(" ");
	for (let e = 1; e * 2 <= t.length; e++) if (t.every((n, r) => n === t[r % e])) return t.slice(0, e).join(" ");
	return e;
}
function Io(e) {
	let t = e.replace(/[\s_-]+/g, "");
	return /^[0-9a-f]{12,}$/i.test(t) || /\d{6,}/.test(t) ? "" : e;
}
// runtime/panel-src/inspector/objects.ts
var Lo = /^(inline|inline-block|inline-flex|inline-grid|contents|ruby)/, Ro = /* @__PURE__ */ new Set([
	"span",
	"b",
	"i",
	"em",
	"strong",
	"small",
	"s",
	"u",
	"mark",
	"sub",
	"sup",
	"abbr",
	"bdi",
	"bdo",
	"code",
	"kbd",
	"var",
	"q",
	"cite",
	"ins",
	"del",
	"font",
	"tt",
	"wbr"
]), zo = /* @__PURE__ */ new Set([
	"script",
	"style",
	"noscript",
	"template",
	"link",
	"meta",
	"title",
	"head",
	"br",
	"wbr",
	"option",
	"optgroup",
	"source",
	"track",
	"param",
	"area",
	"map"
]), W = (e) => [...e.childNodes].some((e) => e.nodeType === 3 && (e.textContent ?? "").trim().length > 0), G = (e) => e.localName === "a" || e.localName === "button" || e.getAttribute("role") === "button";
function Bo(e, t) {
	if (ui(e, t)) return !0;
	let n = t.getComputedStyle(e).boxShadow;
	return !!n && n !== "none";
}
function Vo(e, t) {
	return G(e) || zo.has(e.localName) || !Ro.has(e.localName) && !Lo.test(t.getComputedStyle(e).display) ? !1 : !Bo(e, t);
}
var Ho = (e) => (e.textContent ?? "").trim().length > 0;
function Uo(e, t) {
	let n = e.localName;
	if (zo.has(n) || e.ownerSVGElement) return null;
	if (n === "svg") return "icon";
	if (n === "picture") return "image";
	if (n === "img") return e.parentElement?.localName === "picture" ? null : "image";
	if (n === "video") return "video";
	if (n === "canvas") return "scene";
	let r = G(e);
	return W(e) || [...e.children].some((e) => Vo(e, t) && Ho(e)) ? !r && Vo(e, t) ? null : r ? "button" : "text" : r ? "button" : Bo(e, t) ? "frame" : null;
}
var Wo = 600;
function Go(e) {
	if (W(e)) return !0;
	let t = 0;
	for (let n of e.querySelectorAll("*")) {
		if (++t > Wo) break;
		if (W(n) && Qr(n)) return !0;
	}
	return !1;
}
var Ko = (e, t = 34) => e.length > t ? `${e.slice(0, t - 1).trimEnd()}…` : e, qo = (e) => Io(decodeURIComponent((e ?? "").split(/[?#]/)[0].split("/").pop() ?? "").replace(/\.[a-z0-9]+$/i, "").replace(/[-_.]+/g, " ").trim()), Jo = (e) => (e.getAttribute("class") ?? "").split(/\s+/)[0].replace(/^_([A-Za-z][\w-]*?)_[A-Za-z0-9-]{5}(_\d+)?$/, "$1").replace(/[-_]+/g, " ").trim();
function Yo(e, t = 40) {
	let n = e.ownerDocument.createTreeWalker(e, 4), r = "";
	for (let e = n.nextNode(), i = 0; e && r.length < t && i < 200; e = n.nextNode(), i++) {
		let t = (e.textContent ?? "").replace(/\s+/g, " ").trim();
		t && !zo.has(e.parentElement?.localName ?? "") && (r += `${r ? " " : ""}${t}`);
	}
	return r;
}
function Xo(e, t) {
	let n = e.getAttribute("aria-label") ?? e.querySelector(":scope > title")?.textContent ?? "";
	if (t === "text" || t === "button") return Ko(Fo((e.innerText || e.textContent || "").replace(/\s+/g, " ").trim()) || n.trim() || Jo(e) || e.localName);
	if (t === "image") {
		let t = e.localName === "img" ? e : e.querySelector("img");
		return Ko(t?.getAttribute("alt")?.trim() || qo(t?.getAttribute("src")) || Jo(e) || "Picture");
	}
	if (t === "video") return Ko(qo(e.currentSrc || e.getAttribute("src") || e.getAttribute("data-src") || e.querySelector("source")?.getAttribute("src")) || Jo(e) || "Video");
	if (t === "icon") return Ko(n.trim() || Jo(e) || "Drawing");
	if (t === "scene") return Ko(Jo(e) || "Canvas");
	let r = Jo(e);
	return Ko(n.trim() || (r ? `${r[0].toUpperCase()}${r.slice(1)}` : "") || Fo(Yo(e)) || e.querySelector("img")?.getAttribute("alt")?.trim() || "Box");
}
function Zo(e, t, n, r = [t]) {
	let i = [];
	for (let n = e; n && n !== t; n = n.parentElement) {
		let e = n.parentElement;
		if (!e) return null;
		let t = [...e.children].filter((e) => e.localName === n.localName);
		i.unshift({
			tag: n.localName,
			nth: t.indexOf(n) + 1,
			of: t.length
		});
	}
	if (!i.length) return null;
	let a = `[${Nt}='${n}']`, o;
	if (r.length > 1 && t.parentElement) {
		let e = [...t.parentElement.children].filter((e) => e.localName === t.localName).indexOf(t) + 1;
		r.filter((t) => t.matches(`${a}:nth-of-type(${e})`)).length === 1 && (a += `:nth-of-type(${e})`, o = {
			nth: r.indexOf(t) + 1,
			of: r.length
		});
	}
	let s = `${a} > ${i.map((e) => `${e.tag.replace(/[^A-Za-z0-9_-]/g, "\\$&")}:nth-of-type(${e.nth})`).join(" > ")}`;
	return s.length <= 300 ? {
		selector: s,
		path: i,
		which: o
	} : null;
}
var Qo = "@page";
function $o(e) {
	let t = e.ownerDocument, n = t.body;
	for (let r = e.parentElement; r && r !== t.body; r = r.parentElement) if (r.id && /^[A-Za-z][\w-]*$/.test(r.id) && t.querySelectorAll(`#${r.id}`).length === 1) {
		n = r;
		break;
	}
	let r = [];
	for (let t = e; t && t !== n; t = t.parentElement) {
		let e = t.parentElement;
		if (!e) return null;
		let n = [...e.children].filter((e) => e.localName === t.localName);
		r.unshift({
			tag: t.localName,
			nth: n.indexOf(t) + 1,
			of: n.length
		});
	}
	if (!r.length) return null;
	let i = `${n === t.body ? "body" : `#${n.id}`} > ${r.map((e) => `${e.tag.replace(/[^A-Za-z0-9_-]/g, "\\$&")}:nth-of-type(${e.nth})`).join(" > ")}`;
	return i.length <= 300 ? {
		selector: i,
		path: r
	} : null;
}
function es(e) {
	let t = 2166136261;
	for (let n = 0; n < e.length; n++) t = Math.imul(t ^ e.charCodeAt(n), 16777619);
	return `pick-${(t >>> 0).toString(36)}`;
}
function ts(e, t) {
	let n = e.ownerDocument, r = (e) => {
		let t = j(tn(e));
		return !!t && Lt(t).length > 0;
	}, i = Qt(e.parentElement);
	for (; i && !r(i);) i = Qt(i.parentElement);
	let a = tn(i), o = Qt(e.parentElement);
	for (; o && !j(tn(o));) o = Qt(o.parentElement);
	let s = j(tn(o)) ?? j(a), c = i && a && s ? Zo(e, i, a, V(n, a)) : null, l = c ?? (a ? null : $o(e));
	if (!l) return null;
	let u = Xo(e, t), d = e.localName === "img" || e.localName === "video" ? e : e.querySelector("img, video"), f = es(l.selector);
	return {
		part: {
			id: f,
			label: u,
			...c && s ? {
				group: s.group,
				parent: s.id,
				files: s.files,
				edit: s.edit
			} : {
				group: "Site",
				files: [],
				edit: []
			},
			kind: t,
			prompt: [{
				where: "Picked in the editor",
				text: u
			}],
			tokens: [],
			targets: [{ selector: l.selector }]
		},
		facts: {
			id: f,
			anchor: c && a ? a : Qo,
			which: l.which,
			path: l.path,
			tag: e.localName,
			classes: e.getAttribute("class") ?? "",
			words: (e.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
			src: d?.getAttribute("src") ?? d?.getAttribute("data-src") ?? ""
		}
	};
}
function ns(e, t) {
	if (e.localName !== t.tag) return !1;
	let n = (e.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
	if (n && n === t.words) return !0;
	let r = e.localName === "img" || e.localName === "video" ? e : e.querySelector("img, video"), i = r?.getAttribute("src") ?? r?.getAttribute("data-src") ?? "";
	if (i && i === t.src) return !0;
	let a = e.getAttribute("class") ?? "";
	return a === t.classes && (!!a || !n && !t.words && !i && !t.src);
}
// runtime/panel-src/inspector/tree.ts
function rs(e) {
	let t = /* @__PURE__ */ new Map(), n = /* @__PURE__ */ new Map();
	return Zt(e).forEach((e, r) => {
		let i = tn(e);
		if (!i || t.has(i) || !j(i)) return;
		t.set(i, r);
		let a = Qt(e.parentElement);
		for (; a && !j(tn(a));) a = Qt(a.parentElement);
		n.set(i, a ? tn(a) : null);
	}), {
		index: t,
		parent: n,
		key: [...t.keys()].map((e) => `${e}<${n.get(e) ?? ""}`).join(",")
	};
}
var is = (e, t) => ({
	key: t.id,
	layer: t.id,
	label: t.label,
	kind: Ie(t, V(e, t.id)[0] ?? null),
	el: V(e, t.id)[0] ?? null,
	els: V(e, t.id)
}), as = `[${Nt}]`, os = 8e3, ss = 4, cs = 4, ls = .9, us = 32, ds = /* @__PURE__ */ new WeakMap(), fs = 400, ps = 8e3, ms = .03, hs = fs, gs = {
	since: 0,
	ms: 0
}, _s = 0, vs = () => void _s++;
function ys(e) {
	let t = performance.now();
	if (t - gs.since >= 1e3) {
		let e = gs.ms / (t - gs.since);
		e > ms ? hs = Math.min(ps, hs * 1.6) : e < ms / 3 && (hs = Math.max(fs, hs * .8)), gs = {
			since: t,
			ms: 0
		};
	}
	return {
		win: e,
		doc: e.document,
		stamp: `${De()}:${_s}:${e.innerWidth}`,
		page: Jt(e.document),
		now: t
	};
}
function bs(e, t) {
	let n = ds.get(e);
	return (!n || n.stamp !== t.stamp || n.page !== t.page && t.now - n.at >= hs) && (n = {
		stamp: t.stamp,
		page: t.page,
		at: t.now
	}, ds.set(e, n)), n;
}
var xs = 0;
function Ss(e) {
	if (xs++) try {
		return e();
	} finally {
		xs--;
	}
	let t = performance.now();
	try {
		return e();
	} finally {
		xs--, gs.ms += performance.now() - t;
	}
}
var Cs = (e) => {
	let t = j(e);
	return !!t && !t.picked && !Ae(t.id);
};
function ws(e, t) {
	let n = bs(e, t);
	if (n.self !== void 0) return n.self;
	let r = e.getAttribute(Nt), i = r ? j(r) : void 0;
	if (r && i) return n.self = {
		el: e,
		layer: r,
		kind: Ie(i, e),
		quiet: i.outline === !1 || !!i.hideWhileInspecting
	};
	if (!e.getClientRects().length) return n.self = null;
	let a = Uo(e, t.win);
	return n.self = !a || !e.parentElement?.closest(as) && [...e.querySelectorAll(as)].some((e) => Cs(e.getAttribute("data-dm"))) ? null : {
		el: e,
		layer: null,
		kind: a,
		quiet: !1
	};
}
function Ts(e, t) {
	let n = bs(e, t);
	if (n.kids) return n.kids;
	let r = [], i = 0, a = (e) => {
		for (let n = e.firstElementChild; n && i < os; n = n.nextElementSibling) {
			i++;
			let e = ws(n, t);
			e ? r.push(e) : n.ownerSVGElement || a(n);
		}
	};
	return Ss(() => a(e)), n.kids = r;
}
function Es(e, t) {
	let n = bs(e, t);
	if (n.has !== void 0) return n.has;
	if (n.kids) return n.has = n.kids.length > 0;
	let r = 0, i = (e) => {
		for (let n = e.firstElementChild; n && r < os; n = n.nextElementSibling) if (r++, ws(n, t) || !n.ownerSVGElement && i(n)) return !0;
		return !1;
	};
	return n.has = Ss(() => i(e));
}
function Ds(e, t, n = !1) {
	let r = [];
	for (let i = e; i && i !== t.doc.body && i !== t.doc.documentElement; i = i.parentElement) {
		let e = ws(i, t);
		e && (n || !e.quiet) && r.unshift(e);
	}
	return r;
}
function Os(e, t) {
	if (e.layer) {
		let n = j(e.layer);
		return n ? {
			key: e.layer,
			layer: e.layer,
			label: n.label,
			kind: e.kind,
			el: e.el,
			els: V(t.doc, e.layer)
		} : null;
	}
	let n = bs(e.el, t);
	if (n.target !== void 0) return n.target;
	let r = ts(e.el, e.kind);
	return n.target = r ? {
		key: r.part.id,
		layer: null,
		label: r.part.label,
		kind: e.kind,
		el: e.el,
		els: [e.el],
		object: r
	} : null;
}
var ks = (e) => e.getBoundingClientRect();
function As(e, t, n) {
	let r = ks(e);
	if (t >= r.left && t <= r.right && n >= r.top && n <= r.bottom) return 2;
	let i = r.height < 12 || r.width < 12 ? cs : 0;
	return i && t >= r.left - i && t <= r.right + i && n >= r.top - i && n <= r.bottom + i ? 1 : 0;
}
function js(e, t, n, r, i) {
	let a = e.el, o = yi(a, i.document, i, { cover: !1 }).rects[0];
	if (!o || (e.kind === "text" || e.kind === "button") && !Go(a)) return !1;
	if (As(a, t, n) === 1) return !0;
	let s = r.findIndex((e) => e === a || a.contains(e));
	if (s < 0) return i.getComputedStyle(a).pointerEvents !== "none" || t < o.x - 1 || t > o.x + o.w + 1 || n < o.y - 1 || n > o.y + o.h + 1 ? !1 : !!e.layer || o.w * o.h < .9 * i.innerWidth * i.innerHeight;
	for (let e = 0; e < s; e++) if (!r[e].contains(a) && mi(r[e], a, i)) return !1;
	return !0;
}
function Ms(e, t, n) {
	let r = e.document;
	if (!r.body) return [];
	let i = ys(e), a = r.elementsFromPoint(t, n), o = /* @__PURE__ */ new Map(), s = (e, r) => {
		for (let a of e) As(a.el, t, n) && (a.quiet || o.set(a.el, a), r < us && s(Ts(a.el, i), r + 1));
	};
	s(Ts(r.body, i), 0);
	for (let e of a.slice(0, 12)) {
		let t = Ds(e, i).pop();
		t && o.set(t.el, t);
	}
	let c = (e) => {
		let t = ks(e.el);
		return t.width * t.height;
	}, l = [...o.values()].map((e) => ({
		t: e,
		area: c(e)
	})).sort((e, t) => e.area - t.area || (e.t.el.contains(t.t.el) ? 1 : -1)), u = /* @__PURE__ */ new Map(), d = (r) => u.get(r) ?? (u.set(r, js(r, t, n, a, e)), u.get(r)), f = l.find((e) => d(e.t));
	if (f) {
		let e = f, t = (e) => {
			let t = a.findIndex((t) => t === e.t.el || e.t.el.contains(t));
			return t < 0 ? Infinity : t;
		};
		for (let n of l) {
			if (n.area > e.area * 1.1) break;
			n === e || n.t.el.contains(e.t.el) || e.t.el.contains(n.t.el) || !d(n.t) || t(n) < t(f) && (f = n);
		}
	}
	for (let e = f; e; f = e) {
		let t = e.t.el;
		if (e = l.find((e) => e.t.el !== t && t.contains(e.t.el) && d(e.t)), !e) break;
	}
	return f ? Ds(f.t.el, i) : [];
}
function Ns(e, t) {
	let n = ks(e), r = ks(t), i = Math.min(n.right, r.right) - Math.max(n.left, r.left), a = Math.min(n.bottom, r.bottom) - Math.max(n.top, r.top);
	return i <= 0 || a <= 0 ? !1 : i * a / (n.width * n.height + r.width * r.height - i * a) >= ls;
}
function Ps(e) {
	let t = [], n = [];
	for (let r of e) {
		let e = t[t.length - 1];
		e && Ns(e.el, r.el) ? r.layer && !e.layer && (t[t.length - 1] = r) : t.push(r), n.push(t.length - 1);
	}
	return {
		list: t,
		at: n
	};
}
var Fs = .9, Is = /^(section|header|footer|nav|main)$/;
function Ls(e) {
	if (e.kind === "section" || Is.test(e.el.localName)) return !0;
	let t = e.el.ownerDocument.defaultView?.innerWidth ?? 0;
	return t > 0 && ks(e.el).width >= Fs * t;
}
var Rs = (e) => e.length && Ls(e[0]) ? 1 : 0;
function zs(e, t, n = !1) {
	if (!e.length) return null;
	if (n) return e[e.length - 1];
	let r = -1;
	if (e.forEach((e, n) => {
		t.includes(e.el) && (r = n);
	}), r >= 0) return Bs(e, [e[r].el]) ?? e[r];
	let i = Ps(e).list;
	return i[Rs(i)] ?? i[0];
}
function Bs(e, t) {
	let n = -1;
	return e.forEach((e, r) => {
		t.includes(e.el) && (n = r);
	}), n < 0 ? null : Ps(e.slice(n)).list[1] ?? e[n + 1] ?? null;
}
function Vs(e, t) {
	let n = Ds(e, t), r = Ps(n[n.length - 1]?.el === e ? n : [...n, {
		el: e,
		layer: tn(e),
		kind: "frame",
		quiet: !0
	}]);
	return {
		list: r.list,
		step: r.at[r.at.length - 1]
	};
}
function Hs(e, t) {
	let n = ys(e), r = /* @__PURE__ */ new Set();
	for (let e of t.slice(0, 24)) {
		if (!e.isConnected) continue;
		let { list: t, step: i } = Vs(e, n);
		i > Rs(t) && r.add(t[i - 1].el);
	}
	return [...r];
}
function Us(e, t) {
	let n = ys(e), r = t.find((e) => e.isConnected);
	if (!r) return null;
	let { list: i, step: a } = Vs(r, n);
	return a > Rs(i) ? Os(i[a - 1], n) : null;
}
function Ws(e, t) {
	return t.isConnected ? Ss(() => {
		let n = ys(e), r = Ds(t, n);
		for (let e = r.length - 1; e >= 0; e--) {
			let t = Os(r[e], n);
			if (t) return t;
		}
		return null;
	}) : null;
}
function Gs(e, t, n) {
	if (!n) return null;
	let r = ys(e);
	for (let e = t.indexOf(n); e >= 0; e--) {
		let n = Os(t[e], r);
		if (n) return n;
	}
	return null;
}
var Ks = (e) => {
	let t = ks(e);
	return t.width >= ss && t.height >= ss;
}, qs = (e, t) => !!(e.compareDocumentPosition(t) & 4), Js = /* @__PURE__ */ new Map(), Ys = /* @__PURE__ */ new WeakMap();
function Xs(e, t, n = null) {
	let r = e?.defaultView;
	if (!e?.body || !r) return n ? [] : Ce(t).map((e) => Qs(null, e));
	let i = ys(r), a = n ? Ys.get(n) : Js.get(t ?? "");
	if (a && a.stamp === i.stamp && (a.page === i.page || i.now - a.at < hs)) return a.rows;
	let o = Ss(() => Zs(e, i, t, n)), s = {
		stamp: i.stamp,
		page: i.page,
		at: i.now,
		rows: o
	};
	return n ? Ys.set(n, s) : Js.set(t ?? "", s), o;
}
function Zs(e, t, n, r) {
	let i = r ? [r] : n ? V(e, n) : [e.body], a = [], o = /* @__PURE__ */ new Set();
	for (let e of i) for (let n of Ts(e, t)) o.has(n.el) || (a.push(n), o.add(n.el));
	let s = (t) => Qs(e, t), c = (e) => {
		let n = Ks(e.el) ? Os(e, t) : null;
		return n && {
			key: n.key,
			part: null,
			target: n,
			kids: Es(e.el, t),
			holdsLayers: !!e.el.querySelector(as)
		};
	};
	if (r) {
		let t = [], n = /* @__PURE__ */ new Set();
		for (let r of a) {
			let i = r.layer ? j(r.layer) : void 0;
			if (i) !n.has(i.id) && V(e, i.id)[0] === r.el && (t.push(s(i)), n.add(i.id));
			else {
				let e = c(r);
				e && t.push(e);
			}
		}
		return t;
	}
	let l = (n) => {
		for (let r = n.parentElement; r && r !== e.body; r = r.parentElement) {
			let e = ws(r, t);
			if (e) return !e.layer;
		}
		return !1;
	}, u = Ce(n).filter((t) => {
		let n = V(e, t.id)[0];
		return !n || !l(n);
	}), d = [], f = 0;
	for (let t of a) {
		if (t.layer) continue;
		let n = c(t);
		if (n) {
			for (; f < u.length; f++) {
				let n = V(e, u[f].id)[0];
				if (n && (qs(t.el, n) || t.el.contains(n))) break;
				d.push(s(u[f]));
			}
			d.push(n);
		}
	}
	for (; f < u.length; f++) d.push(s(u[f]));
	return d;
}
function Qs(e, t) {
	let n = Ce(t.id).length > 0, r = e?.defaultView, i = e?.body && r && t.id !== "site" ? ys(r) : null;
	return {
		key: t.id,
		part: t,
		target: null,
		kids: n || !!i && V(e, t.id).some((e) => Es(e, i)),
		holdsLayers: n
	};
}
function $s(e, t) {
	let n = ys(e);
	return Ds(t, n, !0).filter((e) => e.el !== t).map((e) => Os(e, n)?.key).filter((e) => !!e);
}
// runtime/panel-src/inspector/MapBehind.tsx
var ec = "Update the uberdesigner studio map for this site: the studio says the map is behind the code.", tc = 3;
function nc(e) {
	let [t, n] = (0, E.useState)(null);
	return (0, E.useEffect)(() => {
		let e = !0, t = async () => {
			try {
				let t = await (await p("/__inspector/map-check")).json();
				e && t.ok && n(t.check);
			} catch {}
		};
		return t(), window.addEventListener("focus", t), () => {
			e = !1, window.removeEventListener("focus", t);
		};
	}, [e]), t;
}
var rc = (e) => e.length > tc ? `${e.slice(0, tc).join(", ")} +${e.length - tc} more` : e.join(", ");
function ic({ check: e }) {
	let [t, n] = (0, E.useState)(!1), [r, i] = (0, E.useState)(!1);
	if (!e?.behind) return null;
	let a = [
		e.untagged.length > 0 && `No longer tagged in the code: ${rc(e.untagged.map((e) => e.label))}`,
		e.missingFiles.length > 0 && `Files gone: ${rc(e.missingFiles.map((e) => e.file))}`,
		e.newFiles.length > 0 && `New files no part covers: ${rc(e.newFiles)}`,
		e.promptChanged && "The build prompt changed after the map was made"
	].filter((e) => !!e);
	return /* @__PURE__ */ (0, P.jsxs)("div", {
		className: L.behind,
		role: "status",
		children: [
			/* @__PURE__ */ (0, P.jsxs)("button", {
				type: "button",
				className: L.behindHead,
				onClick: () => i((e) => !e),
				"aria-expanded": r,
				children: [
					/* @__PURE__ */ (0, P.jsx)("span", {
						className: L.behindDot,
						"aria-hidden": "true"
					}),
					/* @__PURE__ */ (0, P.jsx)("strong", { children: "The map is behind the site" }),
					/* @__PURE__ */ (0, P.jsx)("span", {
						className: L.behindMore,
						children: r ? "Less" : "Why"
					})
				]
			}),
			r && /* @__PURE__ */ (0, P.jsx)("ul", { children: a.map((e) => /* @__PURE__ */ (0, P.jsx)("li", { children: e }, e)) }),
			/* @__PURE__ */ (0, P.jsxs)("p", { children: [
				"New or changed parts can't be picked until it's updated. Ask Claude Code to ",
				/* @__PURE__ */ (0, P.jsx)("q", { children: "update the uberdesigner studio map" }),
				"; it keeps your parts and history."
			] }),
			/* @__PURE__ */ (0, P.jsx)("button", {
				type: "button",
				className: L.behindCopy,
				onClick: async () => {
					try {
						await navigator.clipboard.writeText(ec), n(!0), setTimeout(() => n(!1), 1600);
					} catch {}
				},
				children: t ? "Copied" : "Copy the request"
			})
		]
	});
}
// runtime/panel-src/inspector/narrow.ts
var ac = (e) => /\bClaude\/\d/.test(e), oc = (e, t) => ac(e) && t < 958, sc = "design-inspector:narrow-ok";
function cc() {
	try {
		return window.sessionStorage.getItem(sc) === "1";
	} catch {
		return !1;
	}
}
function lc() {
	let [e, t] = (0, E.useState)(() => window.innerWidth), [n, r] = (0, E.useState)(cc), [i, a] = (0, E.useState)(""), o = (0, E.useRef)(null), s = (0, E.useRef)(null);
	(0, E.useEffect)(() => {
		let e = () => t(window.innerWidth);
		return window.addEventListener("resize", e), () => window.removeEventListener("resize", e);
	}, []);
	let c = () => {
		r(!0);
		try {
			window.sessionStorage.setItem(sc, "1");
		} catch {}
	}, l = !n && oc(navigator.userAgent, e);
	if (bo(o, l, c), !l) return null;
	let u = window.location.href, d = async () => {
		try {
			await navigator.clipboard.writeText(u), a("yes"), setTimeout(() => a(""), 2200);
		} catch {
			let e = s.current;
			e && window.getSelection()?.selectAllChildren(e), a("no");
		}
	};
	return /* @__PURE__ */ (0, P.jsx)("div", {
		className: N.narrowBack,
		children: /* @__PURE__ */ (0, P.jsxs)("div", {
			ref: o,
			className: `${N.confirm} ${N.narrow}`,
			role: "dialog",
			"aria-modal": "true",
			"aria-labelledby": "design-inspector-narrow",
			children: [
				/* @__PURE__ */ (0, P.jsx)("h2", {
					id: "design-inspector-narrow",
					children: "The studio needs a wider window"
				}),
				/* @__PURE__ */ (0, P.jsxs)("p", { children: [
					"Copy the link and open it in ",
					/* @__PURE__ */ (0, P.jsx)("strong", { children: "your browser" }),
					"."
				] }),
				/* @__PURE__ */ (0, P.jsx)("code", {
					ref: s,
					className: N.narrowLink,
					children: u
				}),
				/* @__PURE__ */ (0, P.jsx)("p", {
					className: N.narrowNote,
					children: i === "no" ? "Couldn't reach the clipboard. The link is selected: copy it with ⌘C." : "A localhost link works there too: it is this computer."
				}),
				/* @__PURE__ */ (0, P.jsx)("button", {
					type: "button",
					className: L.primary,
					autoFocus: !0,
					onClick: () => void d(),
					children: i === "yes" ? "Link copied" : "Copy link"
				}),
				/* @__PURE__ */ (0, P.jsx)("button", {
					type: "button",
					className: N.narrowStay,
					onClick: c,
					children: "Continue here anyway"
				})
			]
		})
	});
}
// runtime/panel-src/inspector/claudeStatus.ts
var uc = 4e3;
function dc() {
	let [e, t] = (0, E.useState)(null), [n, r] = (0, E.useState)(!1), i = (0, E.useCallback)(async () => {
		try {
			let e = await (await p("/__inspector/status")).json();
			t(e.status), r(!1);
		} catch {
			r(!0);
		}
	}, []);
	(0, E.useEffect)(() => {
		i();
	}, [i]);
	let a = !!e?.installed && e.loggedIn;
	return (0, E.useEffect)(() => {
		if (a) return;
		let e = setInterval(() => void i(), uc);
		return () => clearInterval(e);
	}, [a, i]), {
		status: e,
		ready: a,
		failed: n,
		check: i
	};
}
// runtime/panel-src/inspector/ClaudeConnection.tsx
var fc = "curl -fsSL https://claude.ai/install.sh | bash", pc = "claude auth login", mc = "claude auth login --console", hc = "Connect uberdesigner studio to Claude Code";
function gc({ text: e }) {
	let [t, n] = (0, E.useState)(!1);
	return /* @__PURE__ */ (0, P.jsxs)("div", {
		className: L.command,
		children: [/* @__PURE__ */ (0, P.jsx)("code", { children: e }), /* @__PURE__ */ (0, P.jsx)("button", {
			type: "button",
			className: L.ghost,
			onClick: () => {
				navigator.clipboard.writeText(e).then(() => {
					n(!0), setTimeout(() => n(!1), 1500);
				});
			},
			children: t ? "Copied" : "Copy"
		})]
	});
}
function _c({ status: e, ready: t, failed: n, onCheck: r }) {
	return n ? /* @__PURE__ */ (0, P.jsxs)("div", {
		className: L.setup,
		children: [/* @__PURE__ */ (0, P.jsx)("strong", { children: "Can't reach the dev server" }), /* @__PURE__ */ (0, P.jsxs)("p", { children: [
			"Regenerate works only while ",
			/* @__PURE__ */ (0, P.jsx)("code", { children: "pnpm dev" }),
			" is running."
		] })]
	}) : e ? t ? /* @__PURE__ */ (0, P.jsxs)("p", {
		className: L.connected,
		children: [
			/* @__PURE__ */ (0, P.jsx)("i", {}),
			" Claude Code ",
			e.version,
			" · ",
			e.method,
			e.account ? ` · ${e.account}` : ""
		]
	}) : /* @__PURE__ */ (0, P.jsxs)("div", {
		className: L.setup,
		children: [
			/* @__PURE__ */ (0, P.jsx)("strong", { children: e.installed ? "Sign in to Claude Code" : "Connect Claude Code" }),
			/* @__PURE__ */ (0, P.jsxs)("p", { children: [
				"Regenerate sends your change to Claude through Claude Code on this computer, on your own Claude plan. It isn't",
				" ",
				e.installed ? "signed in" : "installed",
				" yet."
			] }),
			/* @__PURE__ */ (0, P.jsx)("p", { children: "Easiest: in your chat with Claude, say" }),
			/* @__PURE__ */ (0, P.jsx)(gc, { text: hc }),
			/* @__PURE__ */ (0, P.jsx)("p", {
				className: L.phone,
				children: "Claude opens the sign-in for you; you finish it in your browser. This box turns into the Regenerate controls by itself."
			}),
			/* @__PURE__ */ (0, P.jsxs)("details", {
				className: L.moreLog,
				children: [
					/* @__PURE__ */ (0, P.jsx)("summary", { children: "Or do it yourself in a terminal" }),
					/* @__PURE__ */ (0, P.jsxs)("ol", { children: [!e.installed && /* @__PURE__ */ (0, P.jsxs)("li", { children: [
						"Install it:",
						/* @__PURE__ */ (0, P.jsx)(gc, { text: fc }),
						"Then open a new terminal window."
					] }), /* @__PURE__ */ (0, P.jsxs)("li", { children: [
						"Sign in with your Claude subscription. It opens your browser; finish there.",
						/* @__PURE__ */ (0, P.jsx)(gc, { text: pc }),
						/* @__PURE__ */ (0, P.jsxs)("span", {
							className: L.phone,
							children: [
								"Paying per token instead? Use your Anthropic Console account: ",
								/* @__PURE__ */ (0, P.jsx)("code", { children: mc }),
								", or start",
								" ",
								/* @__PURE__ */ (0, P.jsx)("code", { children: "pnpm dev" }),
								" with ",
								/* @__PURE__ */ (0, P.jsx)("code", { children: "ANTHROPIC_API_KEY" }),
								" set."
							]
						})
					] })] }),
					/* @__PURE__ */ (0, P.jsx)("button", {
						type: "button",
						className: L.ghost,
						onClick: r,
						children: "Check again"
					})
				]
			})
		]
	}) : /* @__PURE__ */ (0, P.jsx)("p", {
		className: L.phone,
		children: "Checking Claude Code…"
	});
}
// runtime/panel-src/inspector/ChatBar.tsx
var vc = 6, yc = {
	.5: "Small limit",
	1: "Medium limit",
	2: "Large limit",
	5: "Very large limit"
}, bc = 24;
function xc({ part: e, jobs: t, settings: n, onSettings: r, manual: i, onManual: a, replyTo: o, onReplyTo: s, blocked: c, onWholeSite: l, seed: u, onExplore: d }) {
	let f = qn(e) === "project", [m, h] = (0, E.useState)(""), [g, _] = (0, E.useState)(null), [v, y] = (0, E.useState)(!1), [b, x] = (0, E.useState)(null), S = dc(), ee = i ?? e.edit, C = Jn(e, t)[0] ?? null, w = Xn(f ? [] : Qn(e, ee), C?.state), te = (0, E.useRef)(null), T = !S.ready && (S.status !== null || S.failed);
	(0, E.useEffect)(() => {
		x(null), y(!1);
	}, [e]), (0, E.useLayoutEffect)(() => {
		let e = te.current;
		if (!e) return;
		if (!m) return void (e.style.height = "");
		e.style.height = "auto";
		let t = parseFloat(getComputedStyle(e).lineHeight) || 18;
		e.style.height = `${Math.min(e.scrollHeight, t * vc + 12)}px`;
	}, [m]);
	let ne = Ae(e.id);
	(0, E.useEffect)(() => {
		if (f) return _(null);
		let t = setTimeout(() => {
			p("/__inspector/context", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					partId: ne ? e.parent : e.id,
					request: m,
					files: i ?? void 0,
					page: i ? void 0 : Ln(ne ? e.parent ?? e.id : e.id)
				})
			}).then((e) => e.json()).then((e) => _(e.ok ? e : null)).catch(() => _(null));
		}, 350);
		return () => clearTimeout(t);
	}, [
		e,
		m,
		i,
		f
	]);
	let re = C && !Ze(C) ? C.id : null;
	(0, E.useEffect)(() => {
		if (!C || Ze(C)) return;
		let e = (C.files ?? []).filter((e) => Un.test(e));
		e.length && a((t) => t && [.../* @__PURE__ */ new Set([...t, ...e])]), C.error && /log ?in|logged/i.test(C.error) && S.check();
	}, [re]);
	let [ie, ae] = (0, E.useState)(!1);
	(0, E.useEffect)(() => {
		if (!u) return;
		h(u.text), ae(!0), requestAnimationFrame(() => {
			let e = te.current;
			e && (e.focus(), e.setSelectionRange(u.text.length, u.text.length));
		});
		let e = setTimeout(() => ae(!1), 1800);
		return () => clearTimeout(e);
	}, [u?.n]), (0, E.useEffect)(() => {
		o && te.current?.focus();
	}, [o]);
	let oe = i ? Zn(e, m, ee, w) : g?.tokens ?? Zn(e, m, ee, w), se = t.jobs.filter((e) => e.state === "running").length, ce = !!C && Ze(C) || se >= t.max || t.jobs.some((e) => e.mode === "project" && Ze(e)), le = S.ready && !!m.trim() && !c && (f || ee.length > 0), D = (t) => a((n) => (n ?? e.edit).includes(t) ? (n ?? e.edit).filter((e) => e !== t) : [...n ?? e.edit, t]), ue = async () => {
		if (le) {
			x(null);
			try {
				let r = await Yn({
					part: e,
					request: m,
					continuing: o,
					settings: n,
					manual: i,
					jobs: t
				});
				i && a(r), h(""), s(null), y(!1);
			} catch (e) {
				x(e instanceof Error ? e.message : "Couldn't start the change");
			}
		}
	}, de = o ? "Your reply" : f ? "What should change across the site?" : e.label.length > bc ? "What should change here?" : `What should change in the ${e.label.toLowerCase()}?`;
	return /* @__PURE__ */ (0, P.jsxs)("div", {
		className: N.chat,
		children: [(v || T) && /* @__PURE__ */ (0, P.jsxs)("div", {
			className: N.chatPop,
			children: [
				/* @__PURE__ */ (0, P.jsx)(_c, {
					status: S.status,
					ready: S.ready,
					failed: S.failed,
					onCheck: () => void S.check()
				}),
				S.ready && !f && /* @__PURE__ */ (0, P.jsxs)("div", {
					className: L.context,
					children: [
						/* @__PURE__ */ (0, P.jsxs)("div", {
							className: L.contextHead,
							children: [/* @__PURE__ */ (0, P.jsx)("span", { children: i ? "Sends the files you picked" : "Sends, picked automatically for this part" }), /* @__PURE__ */ (0, P.jsx)("button", {
								type: "button",
								className: L.link,
								onClick: () => a(i ? null : [.../* @__PURE__ */ new Set([...e.edit, ...g?.sources.map((e) => e.file) ?? []])]),
								children: i ? "back to automatic" : "pick files"
							})]
						}),
						!i && (g?.sources ?? []).map((e) => /* @__PURE__ */ (0, P.jsxs)("div", {
							className: L.contextItem,
							title: e.note,
							children: [/* @__PURE__ */ (0, P.jsx)("code", { children: e.file.replace(/^src\//, "") }), /* @__PURE__ */ (0, P.jsxs)("span", { children: [
								e.note,
								" · ~",
								vt(Math.round(e.chars / 3.6))
							] })]
						}, e.file)),
						i && /* @__PURE__ */ (0, P.jsx)("div", {
							className: L.picks,
							children: Qn(e, ee).map((t) => /* @__PURE__ */ (0, P.jsxs)("label", {
								className: L.pick,
								"data-extra": !e.edit.includes(t),
								children: [
									/* @__PURE__ */ (0, P.jsx)("input", {
										type: "checkbox",
										checked: ee.includes(t),
										onChange: () => D(t)
									}),
									/* @__PURE__ */ (0, P.jsx)("span", { children: t.replace(/^src\//, "") }),
									/* @__PURE__ */ (0, P.jsx)("em", { children: w[t] ? `~${vt(Math.round(w[t] / 3.6))}` : "" })
								]
							}, t))
						}),
						g && !i && /* @__PURE__ */ (0, P.jsxs)("span", {
							className: L.eta,
							children: [
								"Usually about ",
								Math.max(5, Math.round(g.eta.seconds / 5) * 5),
								" s (",
								g.eta.basis,
								")"
							]
						})
					]
				}),
				S.ready && f && /* @__PURE__ */ (0, P.jsxs)("p", {
					className: L.hintBox,
					children: [
						"Claude Code works through the project like it would in a terminal: it reads what it needs, edits files, can run",
						" ",
						/* @__PURE__ */ (0, P.jsx)("code", { children: "pnpm add" }),
						" and checks types. Each step reads its instructions and the files again, so in our tests an everyday change cost about 60k tokens (weighted the way usage is priced) and a big one (a 3D scene) far more. It stops at the limit you pick. Pick a layer instead when the change fits in one part: about 6× fewer tokens."
					]
				})
			]
		}), /* @__PURE__ */ (0, P.jsxs)("div", {
			className: N.chatBox,
			"data-lit": ie,
			children: [
				o && /* @__PURE__ */ (0, P.jsxs)("p", {
					className: L.replying,
					children: [
						"Replying to “",
						o.request.slice(0, 60),
						"”",
						/* @__PURE__ */ (0, P.jsx)("button", {
							type: "button",
							className: L.link,
							onClick: () => s(null),
							children: "cancel"
						})
					]
				}),
				/* @__PURE__ */ (0, P.jsxs)("div", {
					className: N.chatMain,
					children: [/* @__PURE__ */ (0, P.jsxs)("div", {
						className: N.chatInput,
						children: [/* @__PURE__ */ (0, P.jsxs)("button", {
							type: "button",
							className: N.target,
							"data-site": f,
							onClick: f ? void 0 : l,
							title: f ? "Changes across the whole site. Pick a layer to change just that part." : "Change the whole site instead",
							children: [
								!f && /* @__PURE__ */ (0, P.jsx)(Be, { kind: Ie(e, null) }),
								/* @__PURE__ */ (0, P.jsx)("span", { children: e.label }),
								!f && /* @__PURE__ */ (0, P.jsx)("i", {
									"aria-hidden": "true",
									children: "×"
								})
							]
						}), /* @__PURE__ */ (0, P.jsx)("textarea", {
							ref: te,
							rows: 1,
							value: m,
							disabled: !S.ready,
							placeholder: S.ready ? de : "Connect Claude Code to ask for changes",
							onChange: (e) => h(e.target.value),
							onKeyDown: (e) => {
								e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && (e.preventDefault(), ue());
							}
						})]
					}), /* @__PURE__ */ (0, P.jsx)("button", {
						type: "button",
						className: `${L.primary} ${N.send}`,
						disabled: !le,
						onClick: () => void ue(),
						children: o ? "Reply" : ce ? "Queue" : "Run"
					})]
				}),
				/* @__PURE__ */ (0, P.jsxs)("div", {
					className: N.chatMeta,
					children: [
						/* @__PURE__ */ (0, P.jsx)("select", {
							value: n.model,
							onChange: (e) => r({
								...n,
								model: e.target.value
							}),
							"aria-label": "Model",
							children: Rn.map((e) => /* @__PURE__ */ (0, P.jsx)("option", {
								value: e.id,
								children: e.label
							}, e.id))
						}),
						/* @__PURE__ */ (0, P.jsx)("select", {
							value: n.effort,
							onChange: (e) => r({
								...n,
								effort: e.target.value
							}),
							"aria-label": "Effort",
							children: zn.map((e) => /* @__PURE__ */ (0, P.jsxs)("option", {
								value: e,
								children: [e[0].toUpperCase() + e.slice(1), " effort"]
							}, e))
						}),
						f ? /* @__PURE__ */ (0, P.jsx)("select", {
							value: n.budget,
							onChange: (e) => r({
								...n,
								budget: +e.target.value
							}),
							"aria-label": "Budget",
							children: Bn.map((e) => /* @__PURE__ */ (0, P.jsx)("option", {
								value: e,
								children: yc[e] ?? "No limit"
							}, e))
						}) : /* @__PURE__ */ (0, P.jsxs)("button", {
							type: "button",
							className: N.cost,
							onClick: () => S.ready && y((e) => !e),
							"aria-expanded": v,
							title: v ? "Hide what it sends" : "What it sends: the files picked for this change",
							children: [
								ne && g && !i ? "up to " : "≈ ",
								vt(oe),
								" tokens",
								g && !i ? ` ~${Math.max(5, Math.round(g.eta.seconds / 5) * 5)} s` : ""
							]
						}),
						f && S.ready && /* @__PURE__ */ (0, P.jsx)("button", {
							type: "button",
							className: N.howLink,
							onClick: () => y((e) => !e),
							"aria-expanded": v,
							children: v ? "Hide" : "How it works"
						}),
						/* @__PURE__ */ (0, P.jsx)("span", { className: N.grow }),
						/* @__PURE__ */ (0, P.jsxs)("button", {
							type: "button",
							className: N.explore,
							onClick: d,
							title: "uberdesigner's prompt library, on uberdesigner.ai",
							children: [/* @__PURE__ */ (0, P.jsx)("svg", {
								viewBox: "0 0 16 16",
								"aria-hidden": "true",
								children: /* @__PURE__ */ (0, P.jsx)("path", {
									fill: "currentColor",
									d: "M8.03971 0C10.2303 0 12.2163 0.872147 13.6665 2.28554H9.3508C9.81152 2.94181 10.193 3.71531 10.473 4.57228H15.3072C15.6464 5.2828 15.8841 6.05082 16 6.85783H10.947C10.9836 7.2307 11.0035 7.61179 11.0035 7.99941C11.0035 8.38741 10.9837 8.77013 10.947 9.14337H16C15.884 9.95026 15.6465 10.7185 15.3072 11.4289H10.473C10.1931 12.2855 9.81132 13.0585 9.3508 13.7145H13.6665C12.2163 15.1278 10.2303 16 8.03971 16C3.67726 15.9998 0.126457 12.5428 0.00240565 8.23275C0.00082664 8.15543 0 8.07726 0 7.99941C3.85122e-06 7.92139 0.000812699 7.84353 0.00240565 7.76606C0.126807 3.45624 3.67748 0.000257321 8.03971 0Z"
								})
							}), /* @__PURE__ */ (0, P.jsx)("span", { children: "Explore 500+ Prompts" })]
						})
					]
				}),
				c && /* @__PURE__ */ (0, P.jsx)("p", {
					className: L.phone,
					children: c
				}),
				b && /* @__PURE__ */ (0, P.jsx)("p", {
					className: L.error,
					children: b
				})
			]
		})]
	});
}
// runtime/panel-src/inspector/LatestChange.tsx
var Sc = {
	part: 3e5,
	project: 6e5
}, Cc = 12e4;
function wc({ part: e, jobs: t, settings: n, manual: r, onManual: i, onReply: a, onTry: o, blocked: s }) {
	let c = Jn(e, t)[0] ?? null, l = !!c && Ze(c), u = I(l), [d, f] = (0, E.useState)(Wn), [p, m] = (0, E.useState)(null), h = (0, E.useRef)(null), g = r ?? e.edit, _ = Xn([...g, ...c?.needs?.files ?? []], c?.state), v = c && !l ? c.id : null;
	if ((0, E.useEffect)(() => {
		let e = c?.needs;
		f(e ? {
			packages: e.packages,
			files: e.files,
			allowNew: e.newFiles.length > 0
		} : Wn), m(null);
	}, [v]), (0, E.useEffect)(() => {
		h.current?.scrollTo({ top: h.current.scrollHeight });
	}, [c?.log.length]), !c) return null;
	let y = (e) => async () => {
		m(null);
		try {
			await e();
		} catch (e) {
			m(e instanceof Error ? e.message : String(e));
		}
	}, b = y(async () => {
		let a = await Yn({
			part: e,
			request: c.request,
			continuing: c,
			settings: n,
			manual: r,
			extras: d,
			jobs: t
		});
		r && i(a);
	});
	return /* @__PURE__ */ (0, P.jsxs)("div", {
		className: L.result,
		"data-state": c.state,
		children: [
			/* @__PURE__ */ (0, P.jsxs)("p", {
				className: L.jobHead,
				children: [
					/* @__PURE__ */ (0, P.jsx)("strong", { children: "Latest change" }),
					" · ",
					c.request.slice(0, 80)
				]
			}),
			l && /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [/* @__PURE__ */ (0, P.jsx)("div", {
				className: L.bar,
				children: /* @__PURE__ */ (0, P.jsx)("span", {
					style: { transform: `scaleX(${mt(c, u)})` },
					"data-waiting": c.state === "queued"
				})
			}), /* @__PURE__ */ (0, P.jsxs)("div", {
				className: L.progress,
				children: [/* @__PURE__ */ (0, P.jsxs)("span", {
					className: L.eta,
					children: [c.state === "queued" ? "Waiting its turn" : `${ft(c)} · ${gt(u - c.started)}`, c.state === "running" && ht(c, u) ? ` · ${ht(c, u)}` : ""]
				}), /* @__PURE__ */ (0, P.jsx)("button", {
					type: "button",
					className: L.ghost,
					disabled: c.stopped,
					onClick: y(() => t.stop(c.id)),
					children: c.state === "queued" ? "Cancel" : "Stop"
				})]
			})] }),
			c.log.length > 0 && /* @__PURE__ */ (0, P.jsxs)("details", {
				className: L.moreLog,
				children: [/* @__PURE__ */ (0, P.jsx)("summary", { children: "Details" }), /* @__PURE__ */ (0, P.jsx)("ol", {
					className: L.log,
					ref: h,
					children: c.log.map((e, t) => /* @__PURE__ */ (0, P.jsx)("li", { children: e }, t))
				})]
			}),
			c.state === "running" && u - c.started > Sc[c.mode] && /* @__PURE__ */ (0, P.jsx)("p", {
				className: L.advice,
				children: u - c.progress.lastAt > Cc ? `This is taking longer than most changes, and nothing new has come in for ${gt(u - c.progress.lastAt)}. It may be stuck: stopping is probably right.` : "This is taking longer than most changes, but it's still writing. You can keep waiting, or stop it" + (c.mode === "part" ? " (nothing changes until it finishes) and split the request into smaller steps." : " (what it has done so far is kept as a version you can undo).")
			}),
			!l && /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [
				c.undone && /* @__PURE__ */ (0, P.jsx)("p", {
					className: L.phone,
					children: "Undone: this change was taken back."
				}),
				c.error ? /* @__PURE__ */ (0, P.jsx)("p", {
					className: c.stopped ? L.phone : L.error,
					children: c.error
				}) : /* @__PURE__ */ (0, P.jsx)("p", { children: c.summary || "Done." }),
				c.observed?.note && !c.undone && /* @__PURE__ */ (0, P.jsx)("p", {
					className: L.note,
					children: c.observed.note
				}),
				c.needs && !c.files?.length && /* @__PURE__ */ (0, P.jsxs)("div", {
					className: L.needs,
					children: [
						/* @__PURE__ */ (0, P.jsxs)("strong", { children: [
							"To do this for the ",
							e.label.toLowerCase(),
							", Claude needs:"
						] }),
						c.needs.why && /* @__PURE__ */ (0, P.jsx)("p", {
							className: L.phone,
							children: c.needs.why
						}),
						c.needs.packages.map((e) => /* @__PURE__ */ (0, P.jsxs)("label", {
							className: L.pick,
							children: [
								/* @__PURE__ */ (0, P.jsx)("input", {
									type: "checkbox",
									checked: d.packages.includes(e),
									onChange: () => f((t) => ({
										...t,
										packages: t.packages.includes(e) ? t.packages.filter((t) => t !== e) : [...t.packages, e]
									}))
								}),
								/* @__PURE__ */ (0, P.jsxs)("span", { children: ["install ", e] }),
								/* @__PURE__ */ (0, P.jsx)("em", { children: "package" })
							]
						}, e)),
						c.needs.files.map((e) => /* @__PURE__ */ (0, P.jsxs)("label", {
							className: L.pick,
							children: [
								/* @__PURE__ */ (0, P.jsx)("input", {
									type: "checkbox",
									checked: d.files.includes(e),
									onChange: () => f((t) => ({
										...t,
										files: t.files.includes(e) ? t.files.filter((t) => t !== e) : [...t.files, e]
									}))
								}),
								/* @__PURE__ */ (0, P.jsxs)("span", { children: ["edit ", e.replace(/^src\//, "")] }),
								/* @__PURE__ */ (0, P.jsx)("em", { children: _[e] ? `~${vt(Math.round(_[e] / 3.6))}` : "" })
							]
						}, e)),
						c.needs.newFiles.length > 0 && /* @__PURE__ */ (0, P.jsxs)("label", {
							className: L.pick,
							children: [
								/* @__PURE__ */ (0, P.jsx)("input", {
									type: "checkbox",
									checked: d.allowNew,
									onChange: () => f((e) => ({
										...e,
										allowNew: !e.allowNew
									}))
								}),
								/* @__PURE__ */ (0, P.jsxs)("span", { children: ["create ", c.needs.newFiles.map((e) => e.replace(/^src\//, "")).join(", ")] }),
								/* @__PURE__ */ (0, P.jsx)("em", { children: "new" })
							]
						}),
						/* @__PURE__ */ (0, P.jsxs)("div", {
							className: L.runRow,
							children: [/* @__PURE__ */ (0, P.jsxs)("span", {
								className: L.estimate,
								children: [
									"One call · ≈ ",
									vt(Zn(e, c.request, [.../* @__PURE__ */ new Set([...g, ...d.files])], _)),
									" in"
								]
							}), /* @__PURE__ */ (0, P.jsx)("button", {
								type: "button",
								className: L.primary,
								disabled: !!s,
								onClick: () => void b(),
								children: "Allow and run"
							})]
						})
					]
				}),
				/* @__PURE__ */ (0, P.jsxs)("p", {
					className: L.phone,
					children: [
						c.files?.length ? `Changed ${c.files.join(", ")}` : "No files changed",
						c.retried ? " · asked again after another change landed first" : "",
						c.usage && /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [
							" ",
							"· ",
							c.usage.input.toLocaleString(),
							" in / ",
							c.usage.output.toLocaleString(),
							" out",
							c.usage.turns && c.mode === "project" ? ` · ${c.usage.turns} steps` : "",
							c.saved ? ` · saved ~${c.saved.toLocaleString()}` : "",
							" · ",
							c.usage.seconds,
							"s"
						] })
					]
				}),
				/* @__PURE__ */ (0, P.jsxs)("div", {
					className: L.actions,
					children: [
						/* @__PURE__ */ (0, P.jsx)("button", {
							type: "button",
							className: L.ghost,
							onClick: () => a(c),
							children: "Reply"
						}),
						c.entry && /* @__PURE__ */ (0, P.jsx)("button", {
							type: "button",
							className: L.ghost,
							onClick: o,
							title: "Hover and click the site itself",
							children: "Try it on the page"
						}),
						Qe(c) && /* @__PURE__ */ (0, P.jsx)("button", {
							type: "button",
							className: L.ghost,
							onClick: y(() => t.undo(c.thread)),
							children: "Undo this"
						})
					]
				})
			] }),
			p && /* @__PURE__ */ (0, P.jsx)("p", {
				className: L.error,
				children: p
			})
		]
	});
}
// runtime/panel-src/inspector/theme.ts
var Tc = "uberdesigner-studio-theme", Ec = "uberdesigner-studio-theme";
function Dc() {
	try {
		let e = localStorage.getItem(Tc);
		return e === "light" || e === "dark" ? e : null;
	} catch {
		return null;
	}
}
function Oc() {
	return Dc() ?? (window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark");
}
function kc(e = Oc()) {
	document.documentElement.dataset.studioTheme = e;
}
function Ac(e) {
	try {
		localStorage.setItem(Tc, e);
	} catch {}
	kc(e), window.dispatchEvent(new Event(Ec));
}
var jc = (e) => {
	let t = (t) => {
		t.key === Tc && (kc(), e());
	};
	return window.addEventListener(Ec, e), window.addEventListener("storage", t), () => {
		window.removeEventListener(Ec, e), window.removeEventListener("storage", t);
	};
}, Mc = () => (0, E.useSyncExternalStore)(jc, Oc);
// runtime/panel-src/inspector/ReloadBar.tsx
function Nc({ stale: e, onReload: t, className: n }) {
	let r = e.files.length === 1 ? e.files[0] : `${e.files.length} files`;
	return /* @__PURE__ */ (0, P.jsxs)("div", {
		className: n,
		role: "status",
		children: [/* @__PURE__ */ (0, P.jsx)("span", { children: e.asked ? "Your change is in the code. Reload the page to see it." : `${r} changed: reload the page to see it` }), /* @__PURE__ */ (0, P.jsx)("button", {
			type: "button",
			onClick: t,
			children: "Reload page"
		})]
	});
}
// runtime/panel-src/inspector/Outlines.tsx
var Pc = (e) => j(e)?.label ?? "", Fc = 50, Ic = .06, Lc = 250, Rc = 400, zc = {
	before: "Before",
	working: "Changing",
	queued: "Queued",
	changed: "Changed"
}, Bc = {
	selected: [],
	hover: [],
	scope: [],
	marks: []
}, Vc = Fe(() => new Set(O.filter((e) => e.outline !== !1 && !e.hideWhileInspecting).map((e) => e.id))), Hc = (e, t, n) => Vc().has(e) ? V(t, e).flatMap((e) => yi(e, t, n).rects) : [];
function Uc(e) {
	let t = e.defaultView;
	return t ? [...Vc()].map((n) => ({
		id: n,
		rects: Hc(n, e, t)
	})) : [];
}
function Wc(e, t, n) {
	let r = t.defaultView, i = j(e);
	if (!r || !i) return null;
	if (i.outline === !1) {
		let t = n.filter((t) => Te(t.id).some((t) => t.id === e)).flatMap((e) => e.rects);
		if (!t.length) return null;
		let r = Math.min(...t.map((e) => e.x)), i = Math.min(...t.map((e) => e.y));
		return {
			rect: {
				x: r,
				y: i,
				w: Math.max(...t.map((e) => e.x + e.w)) - r,
				h: Math.max(...t.map((e) => e.y + e.h)) - i
			},
			why: "the layers inside it"
		};
	}
	let a = bi(e, t, r);
	if (!a.why) return null;
	let o = V(t, e).find((e) => e.getClientRects().length)?.getBoundingClientRect();
	return o ? {
		rect: {
			x: Math.round(o.left),
			y: Math.round(o.top),
			w: Math.max(4, Math.round(o.width)),
			h: Math.max(4, Math.round(o.height))
		},
		why: a.why
	} : null;
}
var Gc = "instant", Kc = 16, qc = (e, t, n) => t === 1 ? e * Kc : t === 2 ? e * n : e, Jc = 160;
function Yc() {
	let e = (0, E.useRef)(/* @__PURE__ */ new Map()), t = (0, E.useRef)(0), n = (0, E.useCallback)(() => {
		for (let [t, n] of e.current) {
			t.style.scrollSnapType = n;
			let e = t.ownerDocument.defaultView;
			(t === t.ownerDocument.scrollingElement && e ? e : t).scrollBy({
				left: 0,
				top: 0,
				behavior: "smooth"
			});
		}
		e.current.clear();
	}, []);
	return (0, E.useEffect)(() => () => window.clearTimeout(t.current), []), (0, E.useCallback)((r) => {
		let i = r.ownerDocument.defaultView?.getComputedStyle(r).scrollSnapType ?? "none";
		i && i !== "none" && !e.current.has(r) && (e.current.set(r, r.style.scrollSnapType), r.style.scrollSnapType = "none"), window.clearTimeout(t.current), t.current = window.setTimeout(n, Jc);
	}, [n]);
}
var Xc = (0, E.memo)(function({ frame: e, scale: t, passThrough: n, selected: r, seeking: i, hover: a, marks: o, pins: s, onPin: c, onHover: l, onPick: u, onVisible: d, onEditText: f }) {
	Oe();
	let [p, m] = (0, E.useState)(Bc), h = (0, E.useRef)([]), g = (0, E.useRef)(null), _ = Yc(), v = (0, E.useRef)({
		selected: r,
		hover: a,
		marks: o,
		onVisible: d
	});
	v.current = {
		selected: r,
		hover: a,
		marks: o,
		onVisible: d
	};
	let y = (0, E.useRef)({
		of: null,
		at: 0,
		els: []
	}), b = (0, E.useCallback)((t = !1) => {
		let n = e.current?.contentDocument, r = n?.defaultView, i = v.current.selected, a = performance.now();
		return !n?.body || !r || !i || i === "site" ? (y.current = {
			of: i,
			at: a,
			els: []
		}).els : ((t || y.current.of !== i || a - y.current.at > Lc) && (y.current = {
			of: i,
			at: a,
			els: Hs(r, V(n, i))
		}), y.current.els);
	}, [e]);
	(0, E.useEffect)(() => {
		let t = 0, n = "", r = () => {
			let i = e.current?.contentDocument, a = i?.defaultView;
			if (i?.body && a) {
				qt(i);
				let { selected: e, hover: t, marks: r } = v.current, o = (e) => yi(e, i, a, { cover: !1 }).rects, s = {
					selected: e ? Hc(e, i, a) : [],
					hover: t && t.key !== e ? t.layer ? Hc(t.layer, i, a) : t.els.flatMap(o) : [],
					scope: b().flatMap(o),
					marks: Object.keys(r).map((e) => ({
						id: e,
						rects: Hc(e, i, a)
					}))
				}, c = JSON.stringify(s);
				c !== n && (n = c, m(s));
			}
			t = requestAnimationFrame(r);
		};
		return r(), () => cancelAnimationFrame(t);
	}, [e, b]), (0, E.useEffect)(() => {
		let t = "", n = () => {
			let n = e.current?.contentDocument;
			if (!n?.body) return;
			let r = Uc(n);
			h.current = r, n.defaultView && Mi(n.defaultView, r);
			let i = r.filter((e) => e.rects.length).map((e) => e.id).join(",");
			i !== t && (t = i, v.current.onVisible(i));
		}, r = window.setInterval(n, Rc);
		return n(), () => window.clearInterval(r);
	}, [e]);
	let x = (0, E.useRef)(!1);
	(0, E.useEffect)(() => void (x.current = !1), [r]);
	let S = (e) => {
		let n = g.current?.getBoundingClientRect();
		return n ? {
			x: (e.clientX - n.left) / t,
			y: (e.clientY - n.top) / t
		} : {
			x: -1,
			y: -1
		};
	}, ee = (0, E.useRef)({
		at: 0,
		wait: Fc
	}), C = (t, n, r) => {
		let i = e.current?.contentWindow;
		if (!i?.document.body) return null;
		let a = Ms(i, t, n);
		return Gs(i, a, zs(a, b(), r));
	}, w = (t) => {
		let n = e.current?.contentDocument, r = e.current?.contentWindow;
		if (!n || !r) return;
		let { x: i, y: a } = S(t), o = qc(t.deltaX, t.deltaMode, r.innerWidth), s = qc(t.deltaY, t.deltaMode, r.innerHeight), c = n.elementFromPoint(i, a) ?? n.body, l = r.WheelEvent, u = new l("wheel", {
			deltaX: o,
			deltaY: s,
			deltaMode: 0,
			clientX: i,
			clientY: a,
			bubbles: !0,
			cancelable: !0
		});
		if (!c.dispatchEvent(u)) return;
		for (let e = c; e && e !== n.documentElement && e !== n.body; e = e.parentElement) {
			let t = r.getComputedStyle(e), n = s !== 0 && /(auto|scroll)/.test(t.overflowY) && e.scrollHeight > e.clientHeight, i = o !== 0 && /(auto|scroll)/.test(t.overflowX) && e.scrollWidth > e.clientWidth;
			if (n || i) {
				let t = [e.scrollLeft, e.scrollTop];
				if (_(e), e.scrollBy({
					left: o,
					top: s,
					behavior: Gc
				}), e.scrollLeft !== t[0] || e.scrollTop !== t[1]) return;
			}
		}
		let d = n.scrollingElement ?? n.documentElement;
		_(d), n.body && r.getComputedStyle(n.body).scrollSnapType !== "none" && _(n.body), r.scrollBy({
			left: o,
			top: s,
			behavior: Gc
		});
	}, te = e.current?.contentDocument, T = p.selected.length > 0;
	T && (x.current = !0);
	let ne = r && r !== i && te && !T && !x.current ? Wc(r, te, h.current) : null, re = (e, t, n, r = 0) => e.map((e, i) => /* @__PURE__ */ (0, P.jsx)("div", {
		className: L.box,
		"data-state": t,
		style: {
			left: e.x,
			top: e.y,
			width: e.w,
			height: e.h
		},
		children: i === 0 && n && /* @__PURE__ */ (0, P.jsx)("span", {
			className: `${L.tag} ${N.label}`,
			style: r ? { marginLeft: `calc(${r * 30 + 2}px * var(--inv))` } : void 0,
			children: n
		})
	}, `${t}-${i}`)), ie = (e) => e && !n ? s[e]?.length ?? 0 : 0;
	return /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [
		ne && /* @__PURE__ */ (0, P.jsx)("div", {
			className: N.layer,
			"aria-hidden": "true",
			children: /* @__PURE__ */ (0, P.jsx)("div", {
				className: L.box,
				"data-state": "ghost",
				style: {
					left: ne.rect.x,
					top: ne.rect.y,
					width: ne.rect.w,
					height: ne.rect.h
				},
				children: /* @__PURE__ */ (0, P.jsxs)("span", {
					className: `${L.tag} ${N.label}`,
					children: [
						Pc(r),
						" · ",
						j(r)?.outline === !1 ? "the area of " : "not shown: ",
						ne.why
					]
				})
			})
		}),
		p.marks.length > 0 && /* @__PURE__ */ (0, P.jsx)("div", {
			className: N.layer,
			"aria-hidden": "true",
			children: p.marks.filter((e) => o[e.id] && o[e.id] !== "changed").flatMap((e) => e.rects.map((t, n) => /* @__PURE__ */ (0, P.jsx)("div", {
				className: L.pulse,
				"data-state": o[e.id],
				style: {
					left: t.x,
					top: t.y,
					width: t.w,
					height: t.h
				},
				children: n === 0 && /* @__PURE__ */ (0, P.jsxs)("span", {
					className: `${L.mark} ${N.label}`,
					style: s[e.id]?.length ? { marginLeft: `calc(${s[e.id].length * 30 + 2}px * var(--inv))` } : void 0,
					children: [
						zc[o[e.id]],
						" · ",
						Pc(e.id)
					]
				})
			}, `${e.id}-${n}`)))
		}),
		/* @__PURE__ */ (0, P.jsxs)("div", {
			className: N.layer,
			"aria-hidden": "true",
			children: [
				re(p.scope, "scope", null),
				re(p.selected, "selected", a || r && o[r] && o[r] !== "changed" ? null : Pc(r), ie(r)),
				re(p.hover, "hover", a?.label ?? null, ie(a?.key))
			]
		}),
		!n && /* @__PURE__ */ (0, P.jsx)("div", {
			ref: g,
			className: N.catcher,
			"data-hovering": a ? "true" : "false",
			onPointerMove: (e) => {
				let t = performance.now();
				if (t - ee.current.at < ee.current.wait) return;
				let { x: n, y: r } = S(e), i = C(n, r, e.metaKey || e.ctrlKey);
				ee.current = {
					at: t,
					wait: Math.max(Fc, (performance.now() - t) / Ic)
				}, (i?.key ?? null) !== (v.current.hover?.key ?? null) && l(i);
			},
			onPointerLeave: () => l(null),
			onClick: (e) => {
				if (e.detail > 1) return;
				let { x: t, y: n } = S(e);
				u(C(t, n, e.metaKey || e.ctrlKey));
			},
			onMouseDown: (e) => e.detail > 1 && e.preventDefault(),
			onDoubleClick: (t) => {
				let { x: n, y: r } = S(t), i = e.current?.contentWindow;
				if (!i?.document.body) return;
				let a = Ms(i, n, r), o = a[a.length - 1], s = o && (o.kind === "text" || o.kind === "button") ? Gs(i, a, o) : null;
				if (s?.el === o?.el && s && f(n, r, s)) return;
				let c = v.current.selected;
				if (!c) return;
				let l = Gs(i, a, Bs(a, V(i.document, c)));
				l && l.key !== c && u(l);
			},
			onWheel: w
		}),
		!n && /* @__PURE__ */ (0, P.jsx)("div", {
			className: N.pins,
			children: p.marks.filter((e) => s[e.id] && e.rects[0]).flatMap((e) => s[e.id].map((n, r) => /* @__PURE__ */ (0, P.jsx)("button", {
				type: "button",
				className: `${L.pin} ${N.pinAt}`,
				"data-on": "page",
				"data-thread": n.thread,
				style: {
					left: e.rects[0].x,
					top: Math.max(e.rects[0].y, 30 / t),
					"--i": String(r)
				},
				onClick: () => c(n.thread),
				title: `Change ${n.n}: show its card`,
				"aria-label": `Change ${n.n}`,
				children: n.n
			}, n.thread)))
		})
	] });
});
// runtime/panel-src/inspector/textEdit.ts
function Zc(e, t, n) {
	let r = parseFloat(t.font.fontSize) || 16, i = parseFloat(t.font.lineHeight) || r * 1.2, a = t.rect.h < i * 1.6;
	e.style.letterSpacing = `${(parseFloat(t.font.letterSpacing) || 0) / r}em`, a ? (e.style.whiteSpace = "nowrap", e.style.lineHeight = `${t.rect.h}px`, e.style.width = "auto", e.style.minWidth = `${t.rect.w + n}px`) : e.style.lineHeight = String(i / r);
	let o = () => a ? Math.max(e.scrollWidth, e.offsetWidth) > t.rect.w + n + 1 : e.scrollHeight > t.rect.h + n + 1;
	if (!o()) return;
	let s = r * .2, c = r;
	for (let t = 0; t < 8; t++) {
		let t = (s + c) / 2;
		e.style.fontSize = `${t}px`, o() ? c = t : s = t;
	}
	e.style.fontSize = `${s}px`;
}
var Qc = /* @__PURE__ */ new Set([
	"inline",
	"inline-block",
	"contents"
]);
function $c(e, t, n, r) {
	let i = e.caretPositionFromPoint?.(t, n)?.offsetNode ?? e.caretRangeFromPoint?.(t, n)?.startContainer ?? null;
	if (i && i.nodeType === Node.TEXT_NODE && i.textContent?.trim() && r.contains(i)) return i;
	let a = (e) => t >= e.left && t <= e.right && n >= e.top && n <= e.bottom, o = e.createRange(), s = e.createTreeWalker(r, NodeFilter.SHOW_TEXT), c = null;
	for (let e = s.nextNode(); e; e = s.nextNode()) if (e.textContent?.trim() && (c ??= e, o.selectNodeContents(e), Array.from(o.getClientRects()).some(a))) return e;
	return c;
}
var el = (e) => {
	let t = [], n = e.ownerDocument.createTreeWalker(e, NodeFilter.SHOW_TEXT);
	for (let e = n.nextNode(); e; e = n.nextNode()) t.push(e);
	return t;
}, tl = (e) => {
	let t = [], n = e.ownerDocument.createTreeWalker(e, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
	for (let e = n.nextNode(); e; e = n.nextNode()) t.push(e.nodeType === Node.TEXT_NODE ? "#" : e.tagName);
	return t.join(" ");
}, nl = (e) => {
	let t = e.filter((e) => e.data.trim());
	return t.length >= 4 && t.filter((e) => e.data.trim().length <= 1).length >= t.length / 2;
}, rl = (e) => e.replace(/[ \t\r\n\f]+/g, " ").trim();
function il(e, t, n, r, i) {
	let a = $c(e, t, n, r), o = Qt(a?.parentElement);
	for (; o && Ae(tn(o));) o = Qt(o.parentElement);
	let s = tn(o), c = e.defaultView;
	if (!a || !o || !s || !c) return null;
	let l = a.parentElement;
	for (; l !== o && l.parentElement && Qc.has(c.getComputedStyle(l).display);) l = l.parentElement;
	let u = el(l);
	if (nl(u)) {
		let e = l.getBoundingClientRect(), t = c.getComputedStyle(l), n = rl(l.textContent ?? "");
		return {
			partId: s,
			root: l,
			box: {
				partId: s,
				text: n,
				rect: {
					x: e.left,
					y: e.top,
					w: e.width,
					h: e.height
				},
				font: {
					fontFamily: t.fontFamily,
					fontSize: t.fontSize,
					fontWeight: t.fontWeight,
					fontStyle: t.fontStyle,
					lineHeight: t.lineHeight,
					letterSpacing: t.letterSpacing,
					textAlign: t.textAlign,
					textTransform: t.textTransform
				}
			}
		};
	}
	let d = u.map((e) => e.data), f = tl(l), p = l.textContent ?? "", m = {
		editable: l.getAttribute("contenteditable"),
		style: l.getAttribute("style")
	};
	try {
		l.contentEditable = "plaintext-only";
	} catch {
		l.contentEditable = "true";
	}
	l.style.outline = "2px solid #ffcc33", l.style.outlineOffset = "3px", l.style.userSelect = "text", l.style.webkitUserSelect = "text", l.style.cursor = "text", l.spellcheck = !1, l.focus({ preventScroll: !0 });
	let h = c.getSelection(), g = e.caretRangeFromPoint?.(t, n);
	if (h && g) {
		h.removeAllRanges(), h.addRange(g);
		let e = h.modify?.bind(h);
		g.startOffset > 0 && e?.("move", "backward", "character"), e?.("move", "forward", "word"), e?.("extend", "backward", "word");
	}
	let _ = !1, v = () => {
		let e = el(l);
		tl(l) === f && e.length === d.length ? e.forEach((e, t) => e.data !== d[t] && (e.data = d[t])) : c.location.reload();
	}, y = (e) => {
		if (_) return;
		if (_ = !0, l.removeEventListener("keydown", x, !0), l.removeEventListener("keyup", b, !0), l.removeEventListener("keypress", b, !0), l.removeEventListener("blur", S), m.editable === null ? l.removeAttribute("contenteditable") : l.setAttribute("contenteditable", m.editable), m.style === null ? l.removeAttribute("style") : l.setAttribute("style", m.style), c.getSelection()?.removeAllRanges(), !e) return v(), i(null);
		let t = el(l), n = (e, t) => t.includes("\xA0") ? e : e.replace(/ /g, " "), r = n(l.textContent ?? "", p);
		if (r === p) return i(null);
		let a = tl(l) !== f || t.length !== d.length, o = a ? [] : t.map((e, t) => ({
			from: d[t],
			to: n(e.data, d[t])
		})).filter((e) => e.from !== e.to);
		i({
			partId: s,
			changes: o,
			whole: {
				from: rl(p),
				to: rl(r)
			},
			structural: a,
			revert: v
		});
	}, b = (e) => e.stopPropagation(), x = (e) => {
		e.stopPropagation(), e.key === "Enter" ? (e.preventDefault(), y(!0)) : e.key === "Escape" && (e.preventDefault(), y(!1));
	}, S = () => y(!0);
	return l.addEventListener("keydown", x, !0), l.addEventListener("keyup", b, !0), l.addEventListener("keypress", b, !0), l.addEventListener("blur", S), {
		partId: s,
		root: l
	};
}
// runtime/panel-src/inspector/Editor.tsx
var al = {
	large: {
		label: "Desktop XL",
		w: 1920,
		h: 1080
	},
	desktop: {
		label: "Desktop",
		w: 1440,
		h: 900
	},
	tablet: {
		label: "Tablet",
		w: 768,
		h: 1024
	},
	phone: {
		label: "Phone",
		w: 390,
		h: 844
	}
}, ol = Object.keys(al), sl = "uberdesigner-studio-mode";
function cl() {
	try {
		return localStorage.getItem(sl) === "design" ? "design" : "focus";
	} catch {
		return "focus";
	}
}
var ll = {}, ul = {}, dl = 24, fl = 26, pl = 104, ml = `design-inspector:editor:${D.name}`;
function hl() {
	let e = {
		selected: null,
		trying: !1,
		device: "desktop",
		tab: "layers",
		rightTab: "elements",
		collapsed: []
	};
	try {
		let t = {
			...e,
			...JSON.parse(localStorage.getItem(ml) ?? "{}")
		};
		return al[t.device] ? t : {
			...t,
			device: "desktop"
		};
	} catch {
		return e;
	}
}
var gl = Date.now(), _l = /^\/__inspector\/(run|save|text|link|media|motion|param)(\?|$)/, vl = globalThis.__DESIGN_MAP_AT__ ?? 0, yl = "https://uberdesigner.ai/library?utm_source=uberdesigner-skill&utm_medium=skill&utm_campaign=explore-prompts", bl = new URLSearchParams(location.search), xl = bl.get("path") || "/", Sl = bl.get("part"), Cl = Fe(() => O.filter((e) => e.hideWhileInspecting).map((e) => `html[data-inspect] ${Rt(e.id)} { display: none !important; }`).join("\n"));
function wl(e) {
	let t = e.getElementById("design-inspector-hidden");
	!t && Cl() && (t = e.createElement("style"), t.id = "design-inspector-hidden", e.head.appendChild(t)), t && t.textContent !== Cl() && (t.textContent = Cl());
}
var Tl = Fe(() => O.filter((e) => e.id !== "site" && (e.targets?.length ?? 0) > 0)), El = Fe(() => [...new Set(Tl().flatMap((e) => Lt(e).map((e) => e.file ?? "")))].filter(Boolean)), Dl = 1500, Ol = 12e3;
function kl(e, t) {
	if (e.id === "site" || !e.targets?.length || !t || Xt(t, e.id)) return null;
	let n = rn(t, e.id);
	if (n) return `${e.label}: ${n}`;
	let r = It(e);
	if (r.length) return `Nothing on this page matches the address of ${e.label} (${r.join(", ")})`;
	let i = Lt(e), a = i.find((e) => e.forwards);
	return a ? `${e.label} is tagged in the code on a component (${a.file}), but nothing on the page carries the tag: the component may not pass it on. The map can give this layer a selector address instead` : `${e.label} is tagged in the code${i[0]?.file ? ` (${i[0].file})` : ""}, but nothing on this page carries the tag now`;
}
function Al(e) {
	let t = {}, n = e.documentElement.style;
	for (let e = 0; e < n.length; e++) {
		let r = n.item(e);
		r.startsWith("--") && (t[r] = n.getPropertyValue(r).trim());
	}
	return t;
}
var jl = {
	color: "Colours",
	size: "Sizes",
	em: "Letter spacing",
	ms: "Timing",
	number: "Numbers",
	text: "Other"
}, Ml = Fe(() => {
	let e = /* @__PURE__ */ new Map();
	for (let [t, n] of Object.entries(ue)) {
		let r = n.role.includes("›") ? n.role.split("›")[0].trim() : "", i = r && r.length <= 28 ? r : jl[n.kind] ?? "Other";
		e.set(i, [...e.get(i) ?? [], t]);
	}
	return [...e.entries()];
}), Nl = /* @__PURE__ */ new Set([
	"ArrowDown",
	"ArrowUp",
	"PageDown",
	"PageUp",
	" ",
	"Home",
	"End"
]), Pl = 40, Fl = .875;
function Il(e, t) {
	let n = e.contentWindow, r = e.contentDocument;
	if (!n || !r) return !1;
	let i = n.KeyboardEvent, a = new i("keydown", {
		key: t.key,
		code: t.code,
		shiftKey: t.shiftKey,
		bubbles: !0,
		cancelable: !0
	});
	if (!(r.activeElement ?? r.body).dispatchEvent(a)) return !0;
	let o = n.innerHeight * Fl;
	return t.key === "Home" ? n.scrollTo({
		top: 0,
		behavior: "smooth"
	}) : t.key === "End" ? n.scrollTo({
		top: r.documentElement.scrollHeight,
		behavior: "smooth"
	}) : t.key === "ArrowDown" || t.key === "ArrowUp" ? n.scrollBy({
		top: t.key === "ArrowDown" ? Pl : -40,
		behavior: "instant"
	}) : n.scrollBy({
		top: t.key === "PageUp" || t.key === " " && t.shiftKey ? -o : o,
		behavior: "smooth"
	}), !0;
}
function Ll(e) {
	let [t, n] = (0, E.useState)({
		list: [e],
		at: 0
	}), r = (0, E.useCallback)((e) => n((t) => {
		if (t.list[t.at] === e) return t;
		let n = [...t.list.slice(0, t.at + 1), e].slice(-50);
		return {
			list: n,
			at: n.length - 1
		};
	}), []), i = (0, E.useCallback)(() => n((e) => e.at > 0 ? {
		...e,
		at: e.at - 1
	} : e), []), a = (0, E.useCallback)(() => n((e) => e.at < e.list.length - 1 ? {
		...e,
		at: e.at + 1
	} : e), []);
	return {
		selected: t.list[t.at] ?? null,
		select: r,
		back: i,
		forward: a,
		backId: t.at > 0 ? t.list[t.at - 1] : void 0,
		forwardId: t.at < t.list.length - 1 ? t.list[t.at + 1] : void 0
	};
}
function Rl() {
	let e = (0, E.useMemo)(() => {
		let e = hl();
		return !Sl && e.picked && e.selected === e.picked.part.id && !j(e.selected) && je(e.picked.part), e;
	}, []), { selected: t, select: n, back: r, forward: i, backId: a, forwardId: o } = Ll(Sl ?? e.selected), s = (0, E.useRef)(t);
	s.current = t;
	let [c, l] = (0, E.useState)(null), [u, d] = (0, E.useState)(e.device), [h, _] = (0, E.useState)(e.tab), v = Mc(), [y, b] = (0, E.useState)(cl), x = (e) => {
		b(e);
		try {
			localStorage.setItem(sl, e);
		} catch {}
	}, [S, ee] = (0, E.useState)(!1), [C, w] = (0, E.useState)(e.rightTab), [te, T] = (0, E.useState)(!1), [ne, ie] = (0, E.useState)(() => new Set(e.collapsed)), [ae, oe] = (0, E.useState)(() => /* @__PURE__ */ new Set()), [se, ce] = (0, E.useState)(0), [le, de] = (0, E.useState)(e.trying), [pe, me] = (0, E.useState)("window"), [he, ge] = (0, E.useState)(!1), [_e, ve] = (0, E.useState)(!1), [ye, be] = (0, E.useState)(null), xe = le || he || _e, k = (0, E.useRef)(ye);
	k.current = ye;
	let A = (0, E.useRef)(null), M = () => {
		if (!xe) return de(!0);
		de(!1), ge(!1);
		let e = I.current?.contentDocument?.activeElement;
		e?.isContentEditable && e.blur(), k.current || ve(!1);
	}, Ee = (0, E.useRef)(le);
	Ee.current = le;
	let De = (0, E.useRef)(M);
	De.current = M;
	let [Fe, Le] = (0, E.useState)(""), Re = (0, E.useMemo)(() => new Set(Fe.split(",")), [Fe]), [ze, He] = (0, E.useState)({}), [Ue, We] = (0, E.useState)({}), Ge = (0, E.useRef)(Ue);
	Ge.current = Ue;
	let [Je, Qe] = (0, E.useState)(null), [$e, et] = (0, E.useState)(null), F = (0, E.useCallback)((e, t) => {
		Qe(e), et(e && t ? t : null);
	}, []), [nt, rt] = (0, E.useState)(0), it = (0, E.useCallback)(() => rt((e) => e + 1), []), [at, ot] = (0, E.useState)({}), [st, ct] = (0, E.useState)(xl), [lt, dt] = (0, E.useState)(Gn), [ft, pt] = (0, E.useState)(null), [mt, ht] = (0, E.useState)(null), [gt, _t] = (0, E.useState)(null), vt = () => {
		ht(null), _t((e) => ({
			text: "Add ",
			n: (e?.n ?? 0) + 1
		}));
	}, I = (0, E.useRef)(null), yt = (0, E.useRef)(null), bt = (0, E.useRef)(null), [xt, St] = (0, E.useState)({
		w: 900,
		h: 700
	}), R = Ia(nt), z = ut(it), Ct = new Set(z.jobs.filter((e) => e.state === "running" && e.partId).map((e) => e.partId)), wt = new Set(z.jobs.filter((e) => e.state === "queued" && e.partId).map((e) => e.partId)), Tt = new Set(z.threads.filter((e) => e.changed && !e.kept && e.latest.partId && !Ct.has(e.latest.partId)).map((e) => e.latest.partId)), Dt = z.jobs.some((e) => e.mode === "project" && e.state === "running"), Ot = z.threads.find((e) => e.id === z.comparing?.thread)?.latest.partId ?? null, kt = JSON.stringify([
		...Ct,
		"|",
		...wt,
		"|",
		...Tt,
		"|",
		Ot
	]), At = (0, E.useMemo)(() => {
		let e = {};
		return Tt.forEach((t) => e[t] = "changed"), wt.forEach((t) => e[t] = "queued"), Ct.forEach((t) => e[t] = "working"), Ot && e[Ot] && (e[Ot] = "before"), e;
	}, [kt]), jt = To(z.threads), Mt = JSON.stringify(z.threads.filter((e) => !e.resolved && (e.active || e.changed) && e.latest.mode !== "project" && e.latest.partId).map((e) => [
		e.latest.partId,
		jt.get(e.id) ?? 0,
		e.id
	])), Nt = (0, E.useMemo)(() => {
		let e = {};
		for (let [t, n, r] of JSON.parse(Mt)) (e[t] ??= []).push({
			n,
			thread: r
		});
		return Object.values(e).forEach((e) => e.sort((e, t) => e.n - t.n)), e;
	}, [Mt]), Pt = (0, E.useCallback)((e) => {
		w("changes"), window.setTimeout(() => {
			let t = document.querySelector(`article[data-thread="${e}"]`);
			t?.scrollIntoView({ block: "nearest" }), t?.animate([{ boxShadow: "0 0 0 2px #7548d9" }, { boxShadow: "0 0 0 2px rgba(117, 72, 217, 0)" }], {
				duration: 1400,
				easing: "ease-out"
			});
		}, 60);
	}, []), Ft = nc(`${z.jobs.filter((e) => !Ze(e)).length}:${z.jobs.filter((e) => e.undone).length}:${nt}`), It = (0, E.useMemo)(() => new Set(Ft?.absent ?? []), [Ft]), Lt = Oe(), Rt = (0, E.useRef)(vl), [zt, Vt] = (0, E.useState)(!1);
	(0, E.useEffect)(() => {
		if (!z.mapAt || z.mapAt === Rt.current) return;
		let e = !0;
		return p("/__inspector/map").then((e) => e.json()).then((t) => {
			if (e) {
				if (!t.ok || !t.map) throw Error("no map");
				Rt.current = t.at ?? z.mapAt, Pe(t.map), Vt(!1);
			}
		}).catch(() => e && Vt(!0)), () => {
			e = !1;
		};
	}, [z.mapAt]), (0, E.useEffect)(() => {
		t && !j(t) && n(null);
	}, [
		Lt,
		t,
		n
	]);
	let [Ht, Ut] = (0, E.useState)(""), Wt = (0, E.useMemo)(() => er(Ht), [Ht]), B = (0, E.useMemo)(() => tr(Ht, O), [Ht, Lt]), [Gt, Kt] = (0, E.useState)({}), Zt = (0, E.useRef)(Gt);
	Zt.current = Gt;
	let [Qt, $t] = (0, E.useState)(() => /* @__PURE__ */ new Set()), en = (0, E.useRef)(Qt);
	en.current = Qt;
	let tn = (0, E.useCallback)((e) => {
		ja(I.current?.contentDocument, e), $t((t) => t.has(e.family) ? t : /* @__PURE__ */ new Set([...t, e.family]));
	}, []);
	(0, E.useEffect)(() => {
		D.tokensFile && p("/__inspector/tokens").then((e) => e.json()).then((e) => Ut(e.css)).catch(() => Ut(""));
	}, [nt]), (0, E.useEffect)(() => {
		try {
			let e = ke(), n = e && e.id === t && Pn.current?.id === e.id ? {
				part: e,
				facts: Pn.current
			} : null;
			localStorage.setItem(ml, JSON.stringify({
				selected: t,
				trying: le,
				device: u,
				tab: h,
				rightTab: C,
				collapsed: [...ne],
				picked: n
			}));
		} catch {}
	}, [
		t,
		le,
		u,
		h,
		C,
		ne,
		Lt
	]);
	let nn = (0, E.useRef)(/* @__PURE__ */ new Set());
	(0, E.useEffect)(() => {
		let e = z.jobs.filter((e) => Ze(e) && e.queuedAt > gl && !nn.current.has(e.id));
		e.length && (e.forEach((e) => nn.current.add(e.id)), w("changes"));
	}, [z.jobs]);
	let rn = z.threads.some((e) => e.active || e.changed && !e.kept);
	(0, E.useEffect)(() => {
		pt(null), ht(null);
	}, [t]), (0, E.useEffect)(() => {
		let e = yt.current;
		if (!e) return;
		let t = new ResizeObserver(([e]) => St({
			w: e.contentRect.width,
			h: e.contentRect.height
		}));
		return t.observe(e), () => t.disconnect();
	}, []);
	let an = le, on = an ? pe === "window" ? {
		label: "Window",
		w: Math.max(320, Math.round(xt.w)),
		h: Math.max(240, Math.round(xt.h))
	} : al[pe] : al[u], sn = an ? Math.max(120, xt.w) : Math.max(120, xt.w - 48), cn = an ? Math.max(120, xt.h) : Math.max(120, xt.h - fl - dl - pl), ln = Math.min(1, sn / on.w, cn / on.h), un = Math.round((xt.w - on.w * ln) / 2), dn = Math.round(an ? Math.max(0, (xt.h - on.h * ln) / 2) : 38 + Math.max(0, (cn - on.h * ln) / 2)), fn = (0, E.useCallback)((e) => ge((t) => t === e.altKey ? t : e.altKey), []), pn = (0, E.useCallback)((e) => {
		if (ge(e.altKey), e.type !== "keydown") return;
		let t = e.target;
		if (!t?.closest?.("input, textarea, select, [contenteditable]")) {
			if ((e.metaKey || e.ctrlKey) && (g(e, "[") || g(e, "]"))) e.preventDefault(), Zn.current(g(e, "[") ? -1 : 1);
			else if (!(e.metaKey || e.ctrlKey || e.altKey)) {
				if (e.key === "Escape") {
					if (Ee.current) return void De.current();
					Yn.current();
				}
				if (e.view === window && Nl.has(e.key) && !(e.key === " " && t?.closest?.("button, a, summary"))) {
					let t = I.current;
					t && Il(t, e) && e.preventDefault();
				}
			}
		}
	}, []);
	(0, E.useEffect)(() => {
		let e = () => ge(!1);
		return window.addEventListener("mousemove", fn), window.addEventListener("keydown", pn), window.addEventListener("keyup", pn), window.addEventListener("blur", e), () => {
			window.removeEventListener("mousemove", fn), window.removeEventListener("keydown", pn), window.removeEventListener("keyup", pn), window.removeEventListener("blur", e);
		};
	}, [pn]);
	let mn = (0, E.useRef)(pn);
	mn.current = pn;
	let hn = (0, E.useRef)(Date.now()), [gn, _n] = (0, E.useState)(0), [vn, bn] = (0, E.useState)([]), xn = () => {
		let e = I.current, t = e?.contentDocument, n = e?.contentWindow;
		if (!e || !t || !n) return;
		Ke(e), tt(), hn.current = Date.now(), _n((e) => e + 1), bn((e) => vo(e, t)), Si(t), qt(t), Cn(null);
		let r = Xe();
		if (r !== null) for (let e of [
			300,
			900,
			1800
		]) n.setTimeout(() => n.scrollTo({
			top: r,
			behavior: "instant"
		}), e);
		ot(Al(t)), t.documentElement.dataset.inspect = "on", wl(t);
		for (let [e, n] of Object.entries(Ge.current)) t.documentElement.style.setProperty(e, n);
		en.current.forEach((e) => {
			let n = ka(e);
			n && ja(t, n);
		});
		for (let [e, n] of Object.entries(Zt.current)) V(t, e).forEach((e) => Object.entries(n).forEach(([t, n]) => e.style.setProperty(t, n)));
		n.addEventListener("design-inspector:stale", () => window.dispatchEvent(new Event("design-inspector:stale"))), n.addEventListener("mousemove", fn), n.addEventListener("keydown", (e) => mn.current(e)), n.addEventListener("keyup", (e) => mn.current(e));
		let i = n.location.pathname + n.location.search + n.location.hash;
		ct(i), history.replaceState(null, "", `${Ve}?${new URLSearchParams({ path: i })}`);
	};
	(0, E.useEffect)(() => {
		let e = I.current?.contentDocument;
		if (!e) return;
		let t = {};
		for (let n of O) n.id !== "site" && (t[n.id] = Ie(n, Yt(e, n.id)));
		He((e) => JSON.stringify(e) === JSON.stringify(t) ? e : t);
	}, [
		Fe,
		st,
		Lt
	]);
	let [Sn, Cn] = (0, E.useState)(null), wn = (0, E.useRef)(null), Tn = (0, E.useRef)(-1), En = (0, E.useRef)(0), On = (0, E.useRef)(() => void 0);
	(0, E.useEffect)(() => {
		let e = window.setInterval(() => {
			let e = I.current?.contentDocument;
			if (!e?.body || Date.now() - hn.current < Dl) return;
			Cn(Tl().filter((t) => Xt(e, t.id)).map((e) => e.id).join(",")), !k.current && !e.activeElement?.isContentEditable && ve((e) => e && !1);
			let t = rs(e);
			t.key !== wn.current && (wn.current = t.key, Ne(t));
			let n = Jt(e);
			n === Tn.current ? En.current && On.current(e) : (Tn.current = n, ce((e) => e + 1), On.current(e));
			for (let [t, n] of Object.entries(Zt.current)) for (let r of V(e, t)) for (let [e, t] of Object.entries(n)) r.style.getPropertyValue(e) !== t && r.style.setProperty(e, t);
		}, 500);
		return () => window.clearInterval(e);
	}, []);
	let kn = (0, E.useMemo)(() => new Set((Sn ?? "").split(",")), [Sn]);
	yn(() => I.current, {
		jobs: z.jobs,
		stale: !!z.stale,
		comparing: !!z.comparing,
		width: on.w,
		loadedAt: hn.current,
		onReported: () => void z.refresh()
	});
	let An = Sn === "" && Tl().length > 0, jn = (0, E.useMemo)(() => new Set([...It].filter((e) => !kn.has(e))), [It, kn]), Mn = (0, E.useCallback)((e) => {
		let t = O.find((t) => t.id === e);
		if (!t) return;
		_((e) => e === "assets" ? e : "layers");
		let n = I.current?.contentDocument, r = Yt(n, t.id), i = r && n?.defaultView ? $s(n.defaultView, r) : [], a = /* @__PURE__ */ new Set([
			t.group,
			...Te(t.id).map((e) => e.id),
			...i
		]);
		ie((e) => [...e].some((e) => a.has(e)) ? new Set([...e].filter((e) => !a.has(e))) : e), oe((e) => i.every((t) => e.has(t)) ? e : /* @__PURE__ */ new Set([...e, ...i])), requestAnimationFrame(() => bt.current?.querySelector(`[data-layer="${e}"]`)?.scrollIntoView({ block: "nearest" }));
	}, []), Nn = (0, E.useCallback)((e) => {
		Qi("hand"), Vn.current++, Bn(null), n(e), Mn(e);
	}, [Mn]), Pn = (0, E.useRef)(e.picked?.facts ?? null), Fn = (0, E.useRef)(null), In = (0, E.useCallback)((e) => {
		if (!e) return Nn(null);
		if (!j(e.key)) {
			if (!e.object) return;
			Pn.current = e.object.facts, Fn.current = e.el, En.current = 0, je(e.object.part);
		}
		Nn(e.key);
	}, [Nn]);
	On.current = (e) => {
		let t = ke(), r = Pn.current;
		if (!t || !r || r.id !== t.id || s.current !== t.id) return void (En.current = 0);
		let i = Fn.current?.isConnected ? Fn.current : null;
		if (i) {
			let e = ts(i, t.kind ?? "frame"), n = e?.part.targets?.[0]?.selector;
			e && n && (n !== t.targets?.[0]?.selector || e.part.label !== t.label) && (Pn.current = {
				...e.facts,
				id: t.id
			}, Me(n, e.part.label)), En.current = 0;
			return;
		}
		let a = V(e, t.id).find((e) => ns(e, r));
		if (a) {
			Fn.current = i = a, En.current = 0;
			return;
		}
		if (++En.current < (Date.now() - hn.current < Ol ? Ol / 500 : 3)) return;
		En.current = 0;
		let o = j(t.parent);
		F(`${t.label} isn't on the page any more${o ? `: ${o.label}, where it was, is picked` : ""}`), n(o?.id ?? null), Mn(o?.id ?? null);
	};
	let Ln = (0, E.useRef)(null), Rn = (0, E.useCallback)(() => {
		let e = ke(), t = Pn.current;
		return !e || !t || t.id !== e.id ? Promise.resolve() : (Ln.current ??= (async () => {
			try {
				let n = await (await m("/__inspector/layer", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						...t,
						label: e.label,
						kind: e.kind,
						listedIn: e.parent,
						selector: e.targets?.[0]?.selector
					})
				})).json();
				if (!n.ok) throw Error(n.error ?? "The dev server said no");
				let r = await (await m("/__inspector/map")).json();
				r.ok && r.map && (Rt.current = r.at ?? Rt.current, Pe(r.map)), it(), F(n.scripted ? `${e.label} is a layer now. Its words on the page aren't the words in the file: a script sets them, so typing over them won't hold` : `${e.label} is a layer now`);
			} finally {
				Ln.current = null;
			}
		})(), Ln.current);
	}, [it, F]);
	(0, E.useEffect)(() => (f(async (e, t) => {
		let n = ke();
		n && _l.test(e) && (t.includes(`"${n.id}"`) || e.includes(n.id)) && await Rn();
	}), () => f(null)), [Rn]), (0, E.useEffect)(() => {
		let e = ke();
		e && t !== e.id && je(null);
	}, [t]);
	let [zn, Bn] = (0, E.useState)(null), Vn = (0, E.useRef)(0), Hn = zn && !zn.arrival ? zn.id : null, Un = zn?.arrival?.state === "not-here" ? `${zn.label} isn't shown here: ${zn.arrival.why}` : zn?.arrival?.state === "not-found" ? `${zn.label} isn't shown: ${zn.arrival.why}` : null, Wn = (e, t = !1) => {
		if (!e) return;
		Mn(e);
		let n = I.current?.contentDocument, r = I.current?.contentWindow, i = O.find((t) => t.id === e);
		if (!n || !r || !i || e === "site") return;
		let a = ++Vn.current;
		F(null);
		let o = (e) => Xt(n, e), s = kl(i, n), c = e;
		if (!o(e)) {
			let t = O.filter((t) => Te(t.id).some((t) => t.id === e) && o(t.id));
			if (t.length) c = t[0].id;
			else {
				let t = [...Te(e)].reverse().find((e) => o(e.id)), a = t ? Yt(n, t.id) : null, c = !!a && (a.tagName === "CANVAS" || !!a.querySelector("canvas") || Ie(t, a) === "scene");
				Bn(null), F(s ?? (c ? `${i.label} is drawn inside ${t?.label}: it has no element of its own to outline` : `${i.label} has no element of its own on the page: it's listed for its values${t ? ` (it sits in ${t.label})` : ""}`)), t && $i(t.id, n, r, t.at);
				return;
			}
		}
		let l = O.find((e) => e.id === c) ?? i;
		Bn({
			id: e,
			label: i.label,
			arrival: null
		}), $i(c, n, r, c === e ? i.at : l.at, { thorough: t }).then((t) => {
			a === Vn.current && (Bn(t.state === "cancelled" ? null : {
				id: e,
				label: i.label,
				arrival: t
			}), t.state === "shown" && s && F(s));
		});
	}, Kn = (e) => {
		e && (n(e), Wn(e));
	}, qn = (e) => {
		if (e.part) return Kn(e.key);
		In(e.target), Wn(e.key);
	}, Jn = (e) => {
		let t = I.current?.contentWindow, n = t ? Ws(t, e) : null;
		if (!n) return F("That picture isn't in a part of the page that can be picked");
		In(n), Wn(n.key), w("elements");
	}, Yn = (0, E.useRef)(() => void 0);
	Yn.current = () => {
		let e = I.current?.contentDocument, t = s.current;
		In(t && t !== "site" && e?.defaultView ? Us(e.defaultView, V(e, t)) : null);
	};
	let Xn = (e) => {
		let t = e < 0 ? a : o;
		t !== void 0 && (e < 0 ? r() : i(), Wn(t));
	}, Zn = (0, E.useRef)(Xn);
	Zn.current = Xn;
	let Qn = (0, E.useRef)(lt);
	Qn.current = lt;
	let $n = (0, E.useCallback)(async (e, t = !1) => {
		F("Saving the text…");
		try {
			let n = await (await p("/__inspector/text", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					partId: e.partId,
					changes: e.changes,
					whole: e.whole,
					structural: e.structural,
					model: Qn.current.model,
					effort: Qn.current.effort,
					claude: t
				})
			})).json();
			if (!n.ok) throw Error(n.error ?? "The text couldn't be saved");
			n.direct || e.revert(), t && !n.direct ? F(`Sent to Claude: ${n.why ?? "it couldn't be done directly"}`) : Er(n, "Text saved to the file", F, () => void $n(e, !0), it);
		} catch (t) {
			e.revert(), F(t instanceof Error ? t.message : "The text couldn't be saved");
		}
		it();
	}, [it, F]), nr = (0, E.useRef)(In);
	nr.current = In;
	let rr = (0, E.useCallback)((e, t, n) => {
		let r = I.current?.contentDocument;
		if (!r || !n.el) return !1;
		window.getSelection()?.removeAllRanges();
		let i = il(r, e, t, n.el, (e) => {
			ve(!1), vs(), On.current(r), e && $n(e).then(() => On.current(r));
		});
		return i ? (ve(!0), nr.current(n), i.box && be(i.box), F("Typing over the text: Enter keeps it, Escape puts it back"), !0) : !1;
	}, [$n]), ir = (e, t) => {
		let n = ye;
		if (be(null), ve(!1), !n) return;
		let r = t.replace(/\s+/g, " ").trim();
		if (!e || !r || r === n.text) return F(null);
		$n({
			partId: n.partId,
			changes: [],
			whole: {
				from: n.text,
				to: r
			},
			structural: !0,
			revert: () => void 0
		});
	}, ar = () => I.current?.contentDocument?.documentElement ?? null, or = (e, t) => {
		ar()?.style.setProperty(e, t), We((n) => ({
			...n,
			[e]: t
		})), F(null);
	}, sr = (e) => {
		let t = ar();
		t && (at[e] === void 0 ? t.style.removeProperty(e) : t.style.setProperty(e, at[e])), We(({ [e]: t, ...n }) => n);
	}, lr = (e) => V(I.current?.contentDocument, e), ur = (e, t, n, r) => {
		lr(e).forEach((e) => {
			e.style.setProperty(t, n), r && e.style.setProperty(r, `var(${t})`);
		}), Kt((i) => ({
			...i,
			[e]: {
				...i[e],
				[t]: n,
				...r ? { [r]: `var(${t})` } : {}
			}
		})), F(null);
	}, dr = (e, t) => {
		let n = Object.entries(Zt.current[e] ?? {}).filter(([e, n]) => !e.startsWith("--") && n === `var(${t})`).map(([e]) => e);
		lr(e).forEach((e) => [t, ...n].forEach((t) => e.style.removeProperty(t))), Kt(({ [e]: r = {}, ...i }) => {
			let a = Object.fromEntries(Object.entries(r).filter(([e]) => e !== t && !n.includes(e)));
			return Object.keys(a).length ? {
				...i,
				[e]: a
			} : i;
		});
	}, fr = Object.entries(Gt).flatMap(([e, t]) => Object.keys(t).filter((e) => e.startsWith("--")).map((t) => ({
		id: e,
		name: t
	}))), pr = (e, t) => {
		R.set(e, t), F(null);
	}, mr = R.words, hr = R.has ? Object.keys(R.saved).filter((e) => JSON.stringify(mr[e]) !== JSON.stringify(R.saved[e])) : [], gr = Object.keys(Ue).length + fr.length + hr.length, _r = () => {
		Object.keys(Ue).forEach((e) => sr(e)), We({}), fr.forEach(({ id: e, name: t }) => dr(e, t)), Kt({}), R.has && R.reset(), F("Back to the saved version");
	}, vr = () => {
		let e = [];
		Object.keys(Ue).length && (e.push(`/* ${D.tokensFile ?? "tokens"}, :root */`), Object.entries(Ue).forEach(([t, n]) => e.push(`${t}: ${n};`)));
		for (let [t, n] of Object.entries(Gt)) e.length && e.push(""), e.push(`${Bt(O.find((e) => e.id === t) ?? { id: t })} {`), Object.entries(n).forEach(([t, n]) => e.push(`  ${t}: ${n};`)), e.push("}");
		return hr.length && (e.length && e.push(""), e.push(`/* ${D.content?.file ?? "src/content.json"} */`), e.push(JSON.stringify(Object.fromEntries(hr.map((e) => [e, mr[e]])), null, 2))), e.join("\n");
	}, yr = async () => {
		try {
			await navigator.clipboard.writeText(vr()), F("Changes copied");
		} catch {
			F("Couldn't reach the clipboard");
		}
	}, br = async () => {
		let e = [...Object.entries(Ue).map(([e, t]) => ({
			name: e,
			why: Wa(t, Wt.desktop[e] ?? "")
		})), ...Object.entries(Gt).flatMap(([e, t]) => Object.entries(t).filter(([e]) => e.startsWith("--")).map(([t, n]) => ({
			name: t,
			why: Wa(n, B[e]?.desktop[t] ?? Wt.desktop[t] ?? "")
		})))].find((e) => e.why);
		if (e) return F(`Not saved. ${re(e.name, ue[e.name])}: ${e.why}. Fix it or reset it, then save.`);
		F("Saving…");
		try {
			let e = await (await p("/__inspector/save", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					tokens: Ue,
					parts: Gt,
					found: Object.fromEntries(Object.keys(Gt).map((e) => [e, lr(e).length])),
					content: R.has && hr.length ? R.words : void 0,
					fonts: [...Qt].filter((e) => [...Object.values(Ue), ...Object.values(Gt).flatMap((e) => Object.values(e))].some((t) => Pa(t) === e))
				})
			})).json();
			if (!e.ok) throw Error(e.error ?? "Save failed");
			let t = Object.keys(Ue).filter((e) => at[e] !== void 0);
			Object.keys(Ue).forEach((e) => sr(e)), We({}), fr.forEach(({ id: e, name: t }) => dr(e, t)), Kt({}), F(e.missing?.length ? `Saved, except ${e.missing.join(", ")}` : t.length ? `Saved, but the site's code sets ${t.join(", ")}: change it there (ask Claude)` : "Saved to files"), it();
		} catch (e) {
			F(e instanceof Error ? e.message : "Save failed");
		}
	}, H = j(t) ?? null, xr = H ?? O[0], Sr = (0, E.useMemo)(() => H && H.id !== "site" ? wr(H, I.current?.contentDocument) : [], [
		H,
		Fe,
		st,
		nt,
		Lt
	]), Cr = gr ? "Save or reset your live changes first: Claude edits the saved files." : null, [Tr, Dr] = (0, E.useState)({
		part: "",
		names: /* @__PURE__ */ new Map()
	}), Or = !!H && !!Gt[H.id], kr = !!H && Hn === H.id;
	(0, E.useEffect)(() => {
		if (!H || H.id === "site" || !H.tokens.length || Or || kr) return;
		let e = window, t = 0, n = () => {
			let e = B[H.id]?.desktop ?? {}, t = Object.fromEntries(H.tokens.map((t) => [t, e[t] ?? Wt.desktop[t] ?? ""]));
			Dr({
				part: H.id,
				names: Dn(I.current?.contentDocument, H.id, t)
			});
		}, r = window.setTimeout(() => e.requestIdleCallback ? t = e.requestIdleCallback(n, { timeout: 2e3 }) : n(), 400);
		return () => {
			window.clearTimeout(r), t && e.cancelIdleCallback?.(t);
		};
	}, [
		H,
		on.w,
		nt,
		Sn,
		Ht,
		Or,
		kr
	]);
	let Ar = (e) => void (async () => {
		let t = I.current?.contentDocument, n = I.current?.contentWindow;
		if (!t || !n) return;
		let r = e && e !== "site" ? [e, ...Te(e).map((e) => e.id)] : [], i = r.map((e) => Yt(t, e)).find(Boolean) ?? null, a = !!O.find((t) => t.id === e)?.params?.length && z.jobs.some((t) => t.partId === e && t.state === "done" && (t.finished ?? 0) > hn.current), o = i && !a ? await sa(t, i, r) : "reload";
		o === "reload" && Ye(), F(o === "reload" ? "Playing: the site reloads to run its motion again, then comes back here" : o === "animations" ? "Playing the animation" : o === "hover" ? "Showing its hover" : "Playing the reveal again");
	})(), jr = (e) => {
		let t = ue[e], n = (Wt.desktop[e] ?? "").trim();
		return t?.kind === "ms" || fa(n) || /^-?[\d.]+m?s$/.test(n);
	}, Mr = Object.keys(Wt.desktop).filter((e) => !(e in ue)), Nr = (e) => {
		let t = (Wt.desktop[e] ?? "").trim().match(cr)?.[1], n = t && t !== e && t in Wt.desktop ? t : e, r = n === e ? ue[n] : {
			kind: ue[n]?.kind ?? ue[e]?.kind ?? "text",
			role: `${re(e, ue[e])} uses ${re(n, ue[n])} (${n}): changing it here changes it everywhere it's used`,
			label: re(e, ue[e])
		};
		return Pr(e, n, r);
	}, Pr = (e, n, r) => /* @__PURE__ */ (0, P.jsx)(Ka, {
		name: n,
		meta: r,
		saved: Wt.desktop[n] ?? "",
		phone: Wt.mobile[n],
		site: at[n],
		value: Ue[n] ?? at[n] ?? Wt.desktop[n] ?? "",
		changed: n in Ue,
		onChange: (e) => or(n, e),
		onReset: () => sr(n),
		onFont: tn,
		onPlay: jr(n) ? () => Ar(t) : void 0
	}, e), Fr = (e, t) => (n) => {
		let r = B[e.id], i = t ? Te(e.id).reverse().find((e) => B[e.id]?.desktop[n] !== void 0) : void 0, a = i && B[i.id]?.desktop[n] || (Ue[n] ?? at[n] ?? Wt.desktop[n] ?? ""), o = r?.desktop[n] ?? a;
		return /* @__PURE__ */ (0, P.jsx)(Ka, {
			name: n,
			meta: ue[n],
			saved: o,
			phone: r?.mobile[n] ?? Wt.mobile[n],
			value: Gt[e.id]?.[n] ?? o,
			changed: n in (Gt[e.id] ?? {}),
			onChange: (r) => ur(e.id, n, r, t),
			onReset: () => dr(e.id, n),
			inert: !t && Tr.part === e.id && !(n in (Gt[e.id] ?? {})) ? Tr.names.get(n) : void 0,
			scope: e.label,
			onFont: tn,
			onPlay: jr(n) ? () => Ar(e.id) : void 0
		}, `${e.id}:${n}`);
	}, Ir = (e, t) => Hn === e.id ? /* @__PURE__ */ (0, P.jsx)("span", {
		className: L.chip,
		"data-state": "working",
		"data-seeking": "",
		title: "Finding where this layer shows on the page",
		children: "mapping…"
	}) : Ct.has(e.id) || e.id === "site" && Dt ? /* @__PURE__ */ (0, P.jsx)("span", {
		className: L.chip,
		"data-state": "working",
		children: "changing"
	}) : wt.has(e.id) ? /* @__PURE__ */ (0, P.jsx)("span", {
		className: L.chip,
		"data-state": "queued",
		children: "queued"
	}) : Tt.has(e.id) ? /* @__PURE__ */ (0, P.jsx)("span", {
		className: L.chip,
		"data-state": "changed",
		children: "changed"
	}) : z.settingFlags[e.id] ? /* @__PURE__ */ (0, P.jsx)("span", {
		className: L.chip,
		"data-state": "queued",
		title: "A setting of this layer moved or lost its place in the code: open the layer to check it",
		children: "check"
	}) : An ? null : Sn !== null && (e.targets?.length ?? 0) > 0 && !kn.has(e.id) ? /* @__PURE__ */ (0, P.jsx)("span", {
		className: N.off,
		title: "Nothing on this page carries this layer now: it may be on another page, or appear only in some state. Pick it to see why.",
		children: "not on page"
	}) : !t && e.group !== "Site" && e.outline !== !1 ? /* @__PURE__ */ (0, P.jsx)("span", {
		className: N.off,
		title: "Not visible at this size or scroll position",
		children: "hidden"
	}) : null, Lr = (e) => ie((t) => t.has(e) ? new Set([...t].filter((t) => t !== e)) : /* @__PURE__ */ new Set([...t, e])), Rr = I.current?.contentDocument ?? null, Vr = (e) => e.kids && (e.holdsLayers ? !ne.has(e.key) : ae.has(e.key)), Hr = (e) => e.holdsLayers ? Lr(e.key) : oe((t) => t.has(e.key) ? new Set([...t].filter((t) => t !== e.key)) : /* @__PURE__ */ new Set([...t, e.key])), Ur = (e, n) => {
		let r = e.part;
		if (r && jn.has(r.id)) return null;
		let i = Vr(e), a = i ? Xs(Rr, r ? r.id : null, r ? null : e.target?.el ?? null) : [], o = r ? r.label : e.target?.label ?? "";
		return /* @__PURE__ */ (0, P.jsxs)("li", { children: [/* @__PURE__ */ (0, P.jsxs)("div", {
			className: N.layerRow,
			style: { "--depth": n },
			"data-active": e.key === t,
			"data-hover": e.key === c?.key && e.key !== t,
			"data-changed": !!r && Tt.has(r.id),
			onPointerEnter: () => l(r ? is(Rr, r) : e.target),
			onPointerLeave: () => l(null),
			children: [e.kids ? /* @__PURE__ */ (0, P.jsx)("button", {
				type: "button",
				className: N.twist,
				"aria-expanded": i,
				"aria-label": i ? `Close ${o}` : `Open ${o}`,
				onClick: () => Hr(e),
				children: /* @__PURE__ */ (0, P.jsx)("svg", {
					className: N.chevron,
					viewBox: "0 0 16 16",
					"aria-hidden": "true",
					children: /* @__PURE__ */ (0, P.jsx)("path", { d: "m6 4 4 4-4 4" })
				})
			}) : /* @__PURE__ */ (0, P.jsx)("span", { className: N.twist }), /* @__PURE__ */ (0, P.jsxs)("button", {
				type: "button",
				className: N.layerPick,
				"data-layer": e.key,
				"data-listed": r && !Ae(r.id) ? "true" : "false",
				onClick: () => qn(e),
				children: [
					/* @__PURE__ */ (0, P.jsx)(Be, { kind: r ? r.id === "site" ? "site" : ze[r.id] ?? Ie(r, null) : e.target?.kind ?? "frame" }),
					/* @__PURE__ */ (0, P.jsx)("span", {
						className: N.layerName,
						children: o
					}),
					r && Ir(r, Re.has(r.id) || Ce(r.id).some((e) => Re.has(e.id)))
				]
			})]
		}), i && /* @__PURE__ */ (0, P.jsx)("ul", { children: a.map((e) => Ur(e, n + 1)) })] }, e.key);
	}, Wr = y === "focus" && C === "elements" ? "changes" : C, Gr = z.threads.filter((e) => !e.resolved).length, Kr = z.threads.length - Gr, qr = h === "pages" && vn.length < 2 ? "layers" : h, Jr = ho(new URL(st, location.origin)), Yr = (e) => I.current?.contentWindow?.location.assign(e);
	return /* @__PURE__ */ (0, P.jsxs)("div", {
		className: `${L.root} ${N.editor}`,
		"data-preview": an,
		"data-mode": y,
		children: [
			/* @__PURE__ */ (0, P.jsxs)("header", {
				className: N.topbar,
				hidden: an,
				children: [
					/* @__PURE__ */ (0, P.jsxs)("button", {
						type: "button",
						className: N.brand,
						onClick: () => ee(!0),
						title: "About uberdesigner",
						"aria-label": "About uberdesigner",
						children: [/* @__PURE__ */ (0, P.jsx)("svg", {
							viewBox: "0 0 24 24",
							"aria-hidden": "true",
							children: /* @__PURE__ */ (0, P.jsx)("path", { d: so })
						}), /* @__PURE__ */ (0, P.jsx)("span", { children: "uberdesigner" })]
					}),
					/* @__PURE__ */ (0, P.jsx)("button", {
						type: "button",
						className: N.library,
						onClick: () => T(!0),
						title: "Explore templates",
						"aria-label": "Template library",
						children: /* @__PURE__ */ (0, P.jsxs)("svg", {
							viewBox: "0 0 24 24",
							"aria-hidden": "true",
							children: [/* @__PURE__ */ (0, P.jsx)("path", { d: "M5 7h14l1 13H4L5 7Z" }), /* @__PURE__ */ (0, P.jsx)("path", { d: "M8 8V6a4 4 0 0 1 8 0v2" })]
						})
					}),
					/* @__PURE__ */ (0, P.jsx)("span", {
						className: N.slash,
						"aria-hidden": "true",
						children: "/"
					}),
					/* @__PURE__ */ (0, P.jsx)("strong", {
						className: N.siteName,
						title: D.name,
						children: D.name
					}),
					/* @__PURE__ */ (0, P.jsx)("span", { className: N.grow }),
					/* @__PURE__ */ (0, P.jsx)("div", {
						className: N.themes,
						role: "radiogroup",
						"aria-label": "Theme",
						children: ["light", "dark"].map((e) => /* @__PURE__ */ (0, P.jsx)("button", {
							type: "button",
							role: "radio",
							"aria-checked": v === e,
							"aria-label": e === "light" ? "Light" : "Dark",
							title: e === "light" ? "Light" : "Dark",
							onClick: () => Ac(e),
							children: /* @__PURE__ */ (0, P.jsx)("svg", {
								viewBox: "0 0 16 16",
								"aria-hidden": "true",
								children: e === "light" ? /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [/* @__PURE__ */ (0, P.jsx)("circle", {
									cx: "8",
									cy: "8",
									r: "3"
								}), /* @__PURE__ */ (0, P.jsx)("path", { d: "M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" })] }) : /* @__PURE__ */ (0, P.jsx)("path", { d: "M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z" })
							})
						}, e))
					})
				]
			}),
			an && /* @__PURE__ */ (0, P.jsxs)("div", {
				className: N.previewBar,
				children: [
					/* @__PURE__ */ (0, P.jsxs)("div", {
						className: N.previewStart,
						children: [/* @__PURE__ */ (0, P.jsxs)("button", {
							type: "button",
							className: `${L.ghost} ${N.previewBack}`,
							onClick: M,
							title: "Back to the editor (Esc)",
							children: [/* @__PURE__ */ (0, P.jsx)("svg", {
								viewBox: "0 0 16 16",
								"aria-hidden": "true",
								children: /* @__PURE__ */ (0, P.jsx)("path", { d: "M10 3 5 8l5 5" })
							}), "Back to editor"]
						}), /* @__PURE__ */ (0, P.jsx)("button", {
							type: "button",
							className: `${L.ghost} ${N.replay}`,
							onClick: qe,
							title: "Reload the site and play its intro again",
							"aria-label": "Reload the site",
							children: /* @__PURE__ */ (0, P.jsx)("svg", {
								viewBox: "0 0 24 24",
								"aria-hidden": "true",
								children: /* @__PURE__ */ (0, P.jsx)("path", { d: "M20 5v6h-6M20 11a8 8 0 1 0-2 7" })
							})
						})]
					}),
					/* @__PURE__ */ (0, P.jsxs)("div", {
						className: N.toolbarMid,
						children: [/* @__PURE__ */ (0, P.jsxs)("select", {
							className: N.previewSize,
							value: pe,
							onChange: (e) => {
								me(e.target.value), e.target.blur();
							},
							"aria-label": "Preview size",
							children: [/* @__PURE__ */ (0, P.jsx)("option", {
								value: "window",
								children: "Window"
							}), ol.map((e) => /* @__PURE__ */ (0, P.jsxs)("option", {
								value: e,
								children: [
									al[e].label,
									" · ",
									al[e].w,
									" × ",
									al[e].h
								]
							}, e))]
						}), /* @__PURE__ */ (0, P.jsxs)("span", {
							className: N.zoom,
							title: "The size the site is shown at",
							children: [
								on.w,
								" × ",
								on.h,
								ln < 1 ? ` · ${Math.round(ln * 100)}%` : ""
							]
						})]
					}),
					/* @__PURE__ */ (0, P.jsx)("span", {})
				]
			}),
			/* @__PURE__ */ (0, P.jsxs)("div", {
				className: N.toolbar,
				hidden: an,
				children: [
					/* @__PURE__ */ (0, P.jsx)("div", {
						className: N.modes,
						role: "radiogroup",
						"aria-label": "Mode",
						children: ["focus", "design"].map((e) => /* @__PURE__ */ (0, P.jsx)("button", {
							type: "button",
							role: "radio",
							"aria-checked": y === e,
							onClick: () => x(e),
							title: e === "focus" ? "Focus: the site, your requests and the changes" : "Design: the layers, and the picked layer's values to change by hand",
							children: e === "focus" ? "Focus" : "Design"
						}, e))
					}),
					/* @__PURE__ */ (0, P.jsxs)("div", {
						className: N.toolbarMid,
						children: [
							/* @__PURE__ */ (0, P.jsx)("div", {
								className: N.devices,
								role: "radiogroup",
								"aria-label": "Viewport size",
								children: ol.map((e) => /* @__PURE__ */ (0, P.jsxs)("button", {
									type: "button",
									role: "radio",
									"aria-checked": u === e,
									onClick: () => d(e),
									title: `${al[e].label} · ${al[e].w} × ${al[e].h}`,
									children: [
										/* @__PURE__ */ (0, P.jsx)(Vl, { device: e }),
										/* @__PURE__ */ (0, P.jsx)("span", { children: al[e].label }),
										/* @__PURE__ */ (0, P.jsx)("small", { children: al[e].w })
									]
								}, e))
							}),
							/* @__PURE__ */ (0, P.jsxs)("span", {
								className: N.zoom,
								title: "Shown at this size to fit; the site itself runs at full width",
								children: [Math.round(ln * 100), "%"]
							}),
							/* @__PURE__ */ (0, P.jsxs)("button", {
								type: "button",
								className: N.preview,
								"aria-pressed": xe,
								onClick: M,
								title: xe ? "Back to picking parts of the site" : "Use the site as a visitor would: clicks go to the site, picking pauses (or hold Option)",
								children: [xe ? "Stop preview" : "Preview", /* @__PURE__ */ (0, P.jsx)("svg", {
									viewBox: "0 0 12 12",
									"aria-hidden": "true",
									children: xe ? /* @__PURE__ */ (0, P.jsx)("rect", {
										x: "2.5",
										y: "2.5",
										width: "7",
										height: "7",
										rx: "1"
									}) : /* @__PURE__ */ (0, P.jsx)("path", { d: "M2.25 2.10225C2.25013 1.97066 2.28489 1.84143 2.35077 1.72752C2.41665 1.61361 2.51134 1.51904 2.62533 1.45331C2.73932 1.38757 2.8686 1.35299 3.00019 1.35302C3.13178 1.35305 3.26104 1.38771 3.375 1.4535L10.125 5.34975C10.2392 5.41553 10.334 5.51023 10.4 5.62432C10.4659 5.7384 10.5006 5.86785 10.5006 5.99962C10.5006 6.1314 10.4659 6.26085 10.4 6.37493C10.334 6.48902 10.2392 6.58372 10.125 6.6495L3.375 10.5465C3.26099 10.6123 3.13166 10.647 3 10.647C2.86835 10.647 2.73902 10.6123 2.62501 10.5465C2.51099 10.4807 2.41632 10.386 2.35049 10.272C2.28466 10.158 2.25 10.0287 2.25 9.897V2.10225Z" })
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, P.jsx)("div", {
						className: N.toolbarEnd,
						children: /* @__PURE__ */ (0, P.jsx)("button", {
							type: "button",
							className: `${L.ghost} ${N.replay}`,
							onClick: qe,
							title: "Replay: reload the site and play its intro again",
							"aria-label": "Replay the site",
							children: /* @__PURE__ */ (0, P.jsx)("svg", {
								viewBox: "0 0 24 24",
								"aria-hidden": "true",
								children: /* @__PURE__ */ (0, P.jsx)("path", { d: "M20 5v6h-6M20 11a8 8 0 1 0-2 7" })
							})
						})
					})
				]
			}),
			/* @__PURE__ */ (0, P.jsxs)("aside", {
				className: N.left,
				"aria-label": "Layers",
				children: [
					/* @__PURE__ */ (0, P.jsxs)("div", {
						className: N.tabs,
						role: "tablist",
						children: [
							vn.length > 1 && /* @__PURE__ */ (0, P.jsx)("button", {
								type: "button",
								role: "tab",
								"aria-selected": qr === "pages",
								onClick: () => _("pages"),
								children: "Pages"
							}),
							/* @__PURE__ */ (0, P.jsx)("button", {
								type: "button",
								role: "tab",
								"aria-selected": qr === "layers",
								onClick: () => _("layers"),
								children: "Layers"
							}),
							/* @__PURE__ */ (0, P.jsx)("button", {
								type: "button",
								role: "tab",
								"aria-selected": qr === "assets",
								onClick: () => _("assets"),
								children: "Assets"
							}),
							/* @__PURE__ */ (0, P.jsx)("button", {
								type: "button",
								role: "tab",
								"aria-selected": qr === "history",
								onClick: () => _("history"),
								children: "History"
							})
						]
					}),
					/* @__PURE__ */ (0, P.jsx)("div", {
						className: N.leftScroll,
						ref: bt,
						children: qr === "pages" ? /* @__PURE__ */ (0, P.jsx)("ul", {
							className: L.pages,
							children: vn.map((e) => /* @__PURE__ */ (0, P.jsx)("li", { children: /* @__PURE__ */ (0, P.jsxs)("button", {
								type: "button",
								className: L.pageRow,
								"data-current": e.path === Jr,
								title: e.path,
								onClick: () => Yr(e.path),
								children: [/* @__PURE__ */ (0, P.jsx)("strong", { children: e.label }), /* @__PURE__ */ (0, P.jsx)("small", { children: e.path })]
							}) }, e.path))
						}) : qr === "assets" ? /* @__PURE__ */ (0, P.jsx)(io, {
							doc: Rr,
							version: nt,
							loads: gn,
							selectedEls: t ? Ae(t) && Fn.current ? [Fn.current] : V(Rr, t) : [],
							onPick: Jn
						}) : qr === "history" ? /* @__PURE__ */ (0, P.jsx)(Xa, {
							version: nt,
							onRestored: () => {
								it(), z.refresh();
							}
						}) : /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [
							/* @__PURE__ */ (0, P.jsx)(ic, { check: Ft }),
							An && /* @__PURE__ */ (0, P.jsx)("div", {
								className: L.behind,
								role: "status",
								children: /* @__PURE__ */ (0, P.jsxs)("p", { children: [
									/* @__PURE__ */ (0, P.jsx)("strong", { children: "This page carries none of the map's layers." }),
									" It may not be the page the map describes",
									El().length > 0 && ` (its layers are tagged in ${El().slice(0, 3).join(", ")}${El().length > 3 ? "…" : ""})`,
									", or the tags have left the code. Nothing can be picked here until a page with its layers is open."
								] })
							}),
							zt && /* @__PURE__ */ (0, P.jsxs)("button", {
								type: "button",
								className: N.layersChanged,
								onClick: () => gr ? F("Save or reset your live changes first, then reload the layers") : location.reload(),
								children: ["The layers changed and couldn't be read · ", /* @__PURE__ */ (0, P.jsx)("strong", { children: "Reload layers" })]
							}),
							/* @__PURE__ */ (0, P.jsx)("ul", {
								className: N.tree,
								children: Se() ? /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [Ur(Qs(Rr, O[0]), 0), Xs(Rr, null).map((e) => Ur(e, 0))] }) : fe.map((e) => {
									let t = we(e);
									if (!t.length) return null;
									let n = !ne.has(e);
									return /* @__PURE__ */ (0, P.jsxs)("li", { children: [/* @__PURE__ */ (0, P.jsxs)("button", {
										type: "button",
										className: N.groupRow,
										"aria-expanded": n,
										onClick: () => Lr(e),
										children: [
											/* @__PURE__ */ (0, P.jsx)("svg", {
												className: N.chevron,
												viewBox: "0 0 16 16",
												"aria-hidden": "true",
												children: /* @__PURE__ */ (0, P.jsx)("path", { d: "m6 4 4 4-4 4" })
											}),
											/* @__PURE__ */ (0, P.jsx)(Be, { kind: "group" }),
											/* @__PURE__ */ (0, P.jsx)("span", { children: e })
										]
									}), n && /* @__PURE__ */ (0, P.jsx)("ul", { children: t.map((e) => Ur(Qs(Rr, e), 1)) })] }, e);
								})
							})
						] })
					}),
					qr === "layers" && /* @__PURE__ */ (0, P.jsxs)("button", {
						type: "button",
						className: N.addObject,
						onClick: vt,
						title: "Describe what to add in the chat below: Claude builds it and it joins the layers",
						children: [/* @__PURE__ */ (0, P.jsx)("svg", {
							viewBox: "0 0 16 16",
							"aria-hidden": "true",
							children: /* @__PURE__ */ (0, P.jsx)("path", { d: "M8 3v10M3 8h10" })
						}), "Add new object"]
					})
				]
			}),
			/* @__PURE__ */ (0, P.jsx)("main", {
				className: N.canvas,
				children: /* @__PURE__ */ (0, P.jsxs)("div", {
					className: N.stage,
					ref: yt,
					children: [
						z.stale && /* @__PURE__ */ (0, P.jsx)(Nc, {
							stale: z.stale,
							onReload: Ye,
							className: `${L.reload} ${N.reload}`
						}),
						/* @__PURE__ */ (0, P.jsxs)("div", {
							className: N.frameLabel,
							hidden: an,
							style: {
								left: un,
								top: dn - fl + 4
							},
							children: [
								on.label,
								" ",
								/* @__PURE__ */ (0, P.jsxs)("span", { children: [
									on.w,
									" × ",
									on.h
								] })
							]
						}),
						/* @__PURE__ */ (0, P.jsxs)("div", {
							className: N.frame,
							style: {
								left: un,
								top: dn,
								width: on.w,
								height: on.h,
								transform: `scale(${ln})`,
								"--inv": String(1 / ln)
							},
							children: [
								/* @__PURE__ */ (0, P.jsx)("iframe", {
									ref: I,
									src: xl,
									title: `${D.name}, at ${on.w} × ${on.h}`,
									onLoad: xn
								}),
								/* @__PURE__ */ (0, P.jsx)(Xc, {
									frame: I,
									scale: ln,
									passThrough: xe,
									selected: an ? null : t,
									seeking: Hn,
									hover: an ? null : c,
									marks: an ? ll : At,
									pins: an ? ul : Nt,
									onPin: Pt,
									onHover: l,
									onPick: In,
									onVisible: Le,
									onEditText: rr
								}),
								ye && /* @__PURE__ */ (0, P.jsx)("textarea", {
									className: N.textBox,
									style: {
										left: ye.rect.x - 6,
										top: ye.rect.y - 6,
										width: ye.rect.w + 12,
										minHeight: ye.rect.h + 12,
										...ye.font
									},
									defaultValue: ye.text,
									ref: (e) => {
										e && A.current !== ye && (A.current = ye, Zc(e, ye, 12));
									},
									autoFocus: !0,
									spellCheck: !1,
									onFocus: (e) => e.currentTarget.select(),
									onKeyDown: (e) => {
										e.stopPropagation(), e.key === "Enter" && !e.shiftKey ? (e.preventDefault(), ir(!0, e.currentTarget.value)) : e.key === "Escape" && (e.preventDefault(), ir(!1, ""));
									},
									onBlur: (e) => ir(!0, e.currentTarget.value),
									"aria-label": "New words for this text"
								})
							]
						}),
						/* @__PURE__ */ (0, P.jsx)(xc, {
							part: xr,
							jobs: z,
							settings: lt,
							onSettings: dt,
							manual: ft,
							onManual: pt,
							replyTo: mt,
							onReplyTo: ht,
							blocked: Cr,
							onWholeSite: () => Nn("site"),
							seed: gt,
							onExplore: () => T(!0)
						})
					]
				})
			}),
			/* @__PURE__ */ (0, P.jsxs)("aside", {
				className: N.right,
				"aria-label": "Properties and AI changes",
				children: [
					/* @__PURE__ */ (0, P.jsx)(Et, { finished: z.jobs.filter((e) => !Ze(e)).length }),
					/* @__PURE__ */ (0, P.jsxs)("div", {
						className: `${N.tabs} ${N.rightTabs}`,
						role: "tablist",
						children: [
							y === "design" && /* @__PURE__ */ (0, P.jsx)("button", {
								type: "button",
								role: "tab",
								"aria-selected": Wr === "elements",
								onClick: () => w("elements"),
								children: "Elements"
							}),
							/* @__PURE__ */ (0, P.jsxs)("button", {
								type: "button",
								role: "tab",
								"aria-selected": Wr === "changes",
								onClick: () => w("changes"),
								children: ["AI changes", rn && /* @__PURE__ */ (0, P.jsx)("i", {
									className: N.dot,
									title: "A change is running or waiting for you"
								})]
							}),
							/* @__PURE__ */ (0, P.jsxs)("button", {
								type: "button",
								role: "tab",
								"aria-selected": Wr === "resolved",
								onClick: () => w("resolved"),
								title: "Changes you kept, and changes that are out of the page",
								children: ["Resolved", Kr > 0 && /* @__PURE__ */ (0, P.jsxs)("small", { children: [" ", Kr] })]
							})
						]
					}),
					Wr === "elements" ? /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [/* @__PURE__ */ (0, P.jsxs)("div", {
						className: N.rightScroll,
						children: [/* @__PURE__ */ (0, P.jsxs)("section", {
							className: N.section,
							children: [
								/* @__PURE__ */ (0, P.jsxs)("div", {
									className: N.pickHead,
									children: [
										/* @__PURE__ */ (0, P.jsx)("button", {
											type: "button",
											className: N.navBtn,
											disabled: a === void 0,
											onClick: () => Xn(-1),
											title: "Back to what you picked before (⌘[)",
											"aria-label": "Back",
											children: /* @__PURE__ */ (0, P.jsx)("svg", {
												viewBox: "0 0 16 16",
												"aria-hidden": "true",
												children: /* @__PURE__ */ (0, P.jsx)("path", { d: "M10 3 5 8l5 5" })
											})
										}),
										/* @__PURE__ */ (0, P.jsx)("button", {
											type: "button",
											className: N.navBtn,
											disabled: o === void 0,
											onClick: () => Xn(1),
											title: "Forward (⌘])",
											"aria-label": "Forward",
											children: /* @__PURE__ */ (0, P.jsx)("svg", {
												viewBox: "0 0 16 16",
												"aria-hidden": "true",
												children: /* @__PURE__ */ (0, P.jsx)("path", { d: "m6 3 5 5-5 5" })
											})
										}),
										/* @__PURE__ */ (0, P.jsx)("h2", {
											className: N.sectionHead,
											children: H ? H.label : "Nothing picked"
										})
									]
								}),
								H && Ae(H.id) && /* @__PURE__ */ (0, P.jsxs)("p", {
									className: L.note,
									children: [
										"Not a layer of the map yet: it becomes one when you change it.",
										" ",
										/* @__PURE__ */ (0, P.jsx)("button", {
											type: "button",
											className: L.link,
											onClick: () => void Rn().catch((e) => F(e instanceof Error ? e.message : "It couldn't be kept")),
											children: "Keep as layer"
										})
									]
								}),
								H && Te(H.id).length > 0 && /* @__PURE__ */ (0, P.jsx)("nav", {
									className: N.crumbs,
									"aria-label": "Layers it sits in",
									children: Te(H.id).map((e) => /* @__PURE__ */ (0, P.jsx)("button", {
										type: "button",
										className: N.crumb,
										onClick: () => Kn(e.id),
										title: `Pick ${e.label}`,
										children: e.label
									}, e.id))
								}),
								H ? /* @__PURE__ */ (0, P.jsx)(zl, {
									part: H,
									content: mr,
									hasWords: R.has,
									token: H.id === "site" ? Nr : Fr(H),
									noElement: H.id === "site" || Sn === null || Xt(I.current?.contentDocument, H.id) ? null : (() => {
										let e = kl(H, I.current?.contentDocument);
										return e ? `${e}. Its own values can't be changed until it's on the page: a value saved for it now would change nothing.` : `${H.label} has no element of its own on the page (it's drawn inside another layer), so a value set for it alone would change nothing. The values it uses are site-wide: change them under Whole site.`;
									})(),
									inherited: Sr,
									inheritedToken: (e) => Fr(H, e.property)(e.token),
									isAnim: jr,
									onPlay: () => Ar(H.id),
									deleteLayer: Ae(H.id) ? null : /* @__PURE__ */ (0, P.jsx)(Br, {
										part: H,
										settings: lt,
										jobs: z,
										blocked: Cr,
										onStatus: F
									}),
									extras: /* @__PURE__ */ (0, P.jsx)(zr, {
										part: H,
										doc: I.current?.contentDocument ?? null,
										seen: Fe,
										version: nt,
										settings: lt,
										jobs: z,
										blocked: Cr,
										onStatus: F,
										onDone: () => {
											it(), z.refresh();
										},
										onPlay: () => Ar(H.id)
									}),
									jobs: z,
									settings: lt,
									manual: ft,
									onManual: pt,
									onReply: ht,
									onTry: () => de(!0),
									blocked: Cr,
									onWord: pr
								}) : /* @__PURE__ */ (0, P.jsx)("p", {
									className: L.empty,
									children: "Click a part of the site, or a row on the left. Double-click to go inside what you picked; double-click words to type over them; Escape goes back up. With nothing picked, the chat below changes the whole site."
								})
							]
						}), Ml().length > 0 && (!H || H.id === "site") && /* @__PURE__ */ (0, P.jsxs)("section", {
							className: N.section,
							children: [
								/* @__PURE__ */ (0, P.jsxs)("h2", {
									className: N.sectionHead,
									children: ["Global tokens ", /* @__PURE__ */ (0, P.jsx)("small", { children: Object.keys(ue).length + Mr.length })]
								}),
								/* @__PURE__ */ (0, P.jsxs)("p", {
									className: N.sectionNote,
									children: [
										"Site-wide values from ",
										D.tokensFile,
										". A change shows on every part that uses it."
									]
								}),
								[...Ml()].sort((e, t) => Number(e[1].every(jr)) - Number(t[1].every(jr))).map(([e, t], n) => /* @__PURE__ */ (0, P.jsxs)("details", {
									className: N.tokenGroup,
									open: n === 0,
									children: [/* @__PURE__ */ (0, P.jsxs)("summary", { children: [
										e,
										" ",
										/* @__PURE__ */ (0, P.jsx)("small", { children: t.length })
									] }), t.map(Nr)]
								}, e)),
								Mr.length > 0 && /* @__PURE__ */ (0, P.jsxs)("details", {
									className: N.tokenGroup,
									children: [/* @__PURE__ */ (0, P.jsxs)("summary", { children: ["Not named in the map ", /* @__PURE__ */ (0, P.jsx)("small", { children: Mr.length })] }), Mr.map(Nr)]
								})
							]
						})]
					}), /* @__PURE__ */ (0, P.jsxs)("footer", {
						className: L.foot,
						children: [
							/* @__PURE__ */ (0, P.jsxs)("span", {
								className: L.count,
								children: [
									Je ?? Un ?? (gr ? `${gr} unsaved change${gr > 1 ? "s" : ""}` : "No changes"),
									Je && $e && /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [" ", /* @__PURE__ */ (0, P.jsx)("button", {
										type: "button",
										className: L.link,
										onClick: $e.run,
										children: $e.label
									})] }),
									!Je && zn?.arrival?.state === "not-found" && zn.arrival.more && /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [" ", /* @__PURE__ */ (0, P.jsx)("button", {
										type: "button",
										className: L.link,
										onClick: () => Wn(zn.id, !0),
										children: "Look for it"
									})] })
								]
							}),
							/* @__PURE__ */ (0, P.jsx)("button", {
								type: "button",
								className: L.ghost,
								onClick: _r,
								disabled: !gr,
								children: "Reset"
							}),
							/* @__PURE__ */ (0, P.jsx)("button", {
								type: "button",
								className: L.ghost,
								onClick: yr,
								disabled: !gr,
								children: "Copy"
							}),
							/* @__PURE__ */ (0, P.jsx)("button", {
								type: "button",
								className: L.primary,
								onClick: br,
								disabled: !gr,
								children: "Save"
							})
						]
					})] }) : /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [/* @__PURE__ */ (0, P.jsx)("div", {
						className: N.rightScroll,
						children: (Wr === "resolved" ? Kr : Gr) ? /* @__PURE__ */ (0, P.jsx)(Ao, {
							jobs: z,
							side: "right",
							place: "side",
							only: Wr === "resolved" ? "resolved" : "active",
							onOpen: (e) => {
								w("elements"), Kn(e);
							}
						}) : /* @__PURE__ */ (0, P.jsx)("p", {
							className: N.changesEmpty,
							children: Wr === "resolved" ? "Nothing here yet. A change comes here once you keep it or undo it, and stays." : Kr ? "Nothing is waiting for you. The changes you kept or undid are in Resolved." : "No changes yet. Ask for one in the chat under the site: each change Claude makes shows here, to review, keep or undo."
						})
					}), y === "focus" && (Je || gr > 0) && /* @__PURE__ */ (0, P.jsxs)("footer", {
						className: L.foot,
						children: [/* @__PURE__ */ (0, P.jsxs)("span", {
							className: L.count,
							children: [Je ?? `${gr} unsaved change${gr > 1 ? "s" : ""}`, Je && $e && /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [" ", /* @__PURE__ */ (0, P.jsx)("button", {
								type: "button",
								className: L.link,
								onClick: $e.run,
								children: $e.label
							})] })]
						}), gr > 0 && /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [/* @__PURE__ */ (0, P.jsx)("button", {
							type: "button",
							className: L.ghost,
							onClick: _r,
							children: "Reset"
						}), /* @__PURE__ */ (0, P.jsx)("button", {
							type: "button",
							className: L.primary,
							onClick: br,
							children: "Save"
						})] })]
					})] })
				]
			}),
			te && /* @__PURE__ */ (0, P.jsx)(Bl, { onClose: () => T(!1) }),
			S && /* @__PURE__ */ (0, P.jsx)(lo, { onClose: () => ee(!1) }),
			/* @__PURE__ */ (0, P.jsx)(lc, {})
		]
	});
}
function zl({ part: e, inherited: t, inheritedToken: n, extras: r, isAnim: i, onPlay: a, deleteLayer: o, content: s, hasWords: c, token: l, noElement: u, jobs: d, settings: f, manual: p, onManual: m, onReply: h, onTry: g, blocked: _, onWord: v }) {
	let y = [...new Set(t.map((e) => e.from))], b = u ? [] : e.tokens.filter(i), x = u ? [] : e.tokens.filter((e) => !i(e));
	return /* @__PURE__ */ (0, P.jsxs)("div", {
		className: L.details,
		children: [
			e.note && /* @__PURE__ */ (0, P.jsx)("p", {
				className: L.note,
				children: e.note
			}),
			/* @__PURE__ */ (0, P.jsx)(wc, {
				part: e,
				jobs: d,
				settings: f,
				manual: p,
				onManual: m,
				onReply: h,
				onTry: g,
				blocked: _
			}),
			u && e.tokens.length > 0 && /* @__PURE__ */ (0, P.jsx)("p", {
				className: L.note,
				children: u
			}),
			x.length > 0 && /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [/* @__PURE__ */ (0, P.jsx)("h3", { children: e.id === "site" ? "Tokens" : `${e.label} only` }), x.map(l)] }),
			y.map((r) => /* @__PURE__ */ (0, P.jsxs)("div", { children: [/* @__PURE__ */ (0, P.jsxs)("h3", { children: [
				e.label,
				" only ",
				/* @__PURE__ */ (0, P.jsxs)("small", {
					className: N.fromNote,
					children: ["· from ", r.id === "site" ? "the page" : r.label]
				})
			] }), t.filter((e) => e.from === r).map(n)] }, r.id)),
			e.id !== "site" && r,
			c && e.content && e.content.length > 0 && /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [/* @__PURE__ */ (0, P.jsx)("h3", { children: "Words" }), e.content.map((e) => {
				let t = s[e];
				return t === void 0 ? null : Array.isArray(t) ? /* @__PURE__ */ (0, P.jsxs)("div", {
					className: L.field,
					children: [/* @__PURE__ */ (0, P.jsx)("span", { children: La(e) }), /* @__PURE__ */ (0, P.jsx)("div", {
						className: L.list,
						children: t.map((n, r) => /* @__PURE__ */ (0, P.jsx)("input", {
							value: n,
							onChange: (n) => v(e, t.map((e, t) => t === r ? n.target.value : e))
						}, r))
					})]
				}, e) : /* @__PURE__ */ (0, P.jsxs)("label", {
					className: L.field,
					children: [/* @__PURE__ */ (0, P.jsx)("span", { children: La(e) }), t.length > 40 ? /* @__PURE__ */ (0, P.jsx)("textarea", {
						rows: 3,
						value: t,
						onChange: (t) => v(e, t.target.value)
					}) : /* @__PURE__ */ (0, P.jsx)("input", {
						value: t,
						onChange: (t) => v(e, t.target.value)
					})]
				}, e);
			})] }),
			b.length > 0 && /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [/* @__PURE__ */ (0, P.jsxs)("h3", {
				className: L.withPlay,
				children: ["Animation ", /* @__PURE__ */ (0, P.jsx)(Vr, { onPlay: a })]
			}), b.map(l)] }),
			/* @__PURE__ */ (0, P.jsxs)("details", {
				className: N.from,
				open: !e.tokens.length,
				children: [/* @__PURE__ */ (0, P.jsx)("summary", { children: D.source?.kind === "code" ? "From the code" : "From the prompt" }), e.prompt.map((e, t) => /* @__PURE__ */ (0, P.jsxs)("blockquote", {
					className: L.quote,
					children: [/* @__PURE__ */ (0, P.jsx)("cite", { children: e.where }), e.text]
				}, `${t}-${e.where}`))]
			}),
			/* @__PURE__ */ (0, P.jsxs)("details", {
				className: N.from,
				children: [/* @__PURE__ */ (0, P.jsx)("summary", { children: "Files" }), /* @__PURE__ */ (0, P.jsx)("ul", {
					className: L.files,
					children: e.files.map((e) => /* @__PURE__ */ (0, P.jsx)("li", { children: e }, e))
				})]
			}),
			e.id !== "site" && o
		]
	});
}
function Bl({ onClose: e }) {
	let t = (0, E.useRef)(null);
	return bo(t, !0, e), /* @__PURE__ */ (0, P.jsx)("div", {
		className: N.confirmBack,
		onClick: e,
		children: /* @__PURE__ */ (0, P.jsxs)("div", {
			ref: t,
			className: N.confirm,
			role: "dialog",
			"aria-modal": "true",
			"aria-labelledby": "design-inspector-explore",
			onClick: (e) => e.stopPropagation(),
			children: [
				/* @__PURE__ */ (0, P.jsx)("h2", {
					id: "design-inspector-explore",
					children: "Open uberdesigner.ai?"
				}),
				/* @__PURE__ */ (0, P.jsxs)("p", { children: [
					"The prompt library is on our website, ",
					/* @__PURE__ */ (0, P.jsx)("code", { children: "uberdesigner.ai/library" }),
					". It opens in a new browser tab; this editor and your site stay as they are."
				] }),
				/* @__PURE__ */ (0, P.jsxs)("div", {
					className: N.confirmActions,
					children: [/* @__PURE__ */ (0, P.jsx)("button", {
						type: "button",
						className: L.ghost,
						onClick: e,
						children: "Cancel"
					}), /* @__PURE__ */ (0, P.jsx)("button", {
						type: "button",
						className: L.primary,
						autoFocus: !0,
						onClick: () => {
							window.open(yl, "_blank", "noopener,noreferrer"), e();
						},
						children: "Open in a new tab"
					})]
				})
			]
		})
	});
}
function Vl({ device: e }) {
	return /* @__PURE__ */ (0, P.jsxs)("svg", {
		className: N.deviceIcon,
		viewBox: "0 0 16 16",
		"aria-hidden": "true",
		children: [
			e === "phone" && /* @__PURE__ */ (0, P.jsx)("rect", {
				x: "5",
				y: "2",
				width: "6",
				height: "12",
				rx: "1.5"
			}),
			e === "tablet" && /* @__PURE__ */ (0, P.jsx)("rect", {
				x: "3.5",
				y: "2",
				width: "9",
				height: "12",
				rx: "1.5"
			}),
			e === "desktop" && /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [/* @__PURE__ */ (0, P.jsx)("rect", {
				x: "1.5",
				y: "3",
				width: "13",
				height: "8.5",
				rx: "1"
			}), /* @__PURE__ */ (0, P.jsx)("path", { d: "M5.5 14h5" })] }),
			e === "large" && /* @__PURE__ */ (0, P.jsxs)(P.Fragment, { children: [/* @__PURE__ */ (0, P.jsx)("rect", {
				x: "1",
				y: "2",
				width: "14",
				height: "10",
				rx: "1"
			}), /* @__PURE__ */ (0, P.jsx)("path", { d: "M8 12v2M5 14h6" })] })
		]
	});
}
// runtime/panel-src/inspector/mount.tsx
var Hl = () => /(?:^|;\s*)uberdesigner_studio=off/.test(document.cookie);
function Ul() {
	if (document.getElementById("design-inspector") || Ue()) return;
	if (!He()) {
		if (window !== window.parent || Hl()) return;
		location.replace(`${Ve}?${new URLSearchParams({ path: location.pathname + location.search + location.hash })}`);
		return;
	}
	kc();
	let e = document.createElement("div");
	e.id = "design-inspector", document.body.appendChild(e), (0, c.createRoot)(e).render(/* @__PURE__ */ (0, P.jsx)(Rl, {}));
}
// runtime/panel-src/entry.ts
Ul();
