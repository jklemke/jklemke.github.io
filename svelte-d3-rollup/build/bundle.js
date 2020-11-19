(function () {
    'use strict';

    function noop() { }
    function assign(tar, src) {
        // @ts-ignore
        for (const k in src)
            tar[k] = src[k];
        return tar;
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function create_slot(definition, ctx, $$scope, fn) {
        if (definition) {
            const slot_ctx = get_slot_context(definition, ctx, $$scope, fn);
            return definition[0](slot_ctx);
        }
    }
    function get_slot_context(definition, ctx, $$scope, fn) {
        return definition[1] && fn
            ? assign($$scope.ctx.slice(), definition[1](fn(ctx)))
            : $$scope.ctx;
    }
    function get_slot_changes(definition, $$scope, dirty, fn) {
        if (definition[2] && fn) {
            const lets = definition[2](fn(dirty));
            if ($$scope.dirty === undefined) {
                return lets;
            }
            if (typeof lets === 'object') {
                const merged = [];
                const len = Math.max($$scope.dirty.length, lets.length);
                for (let i = 0; i < len; i += 1) {
                    merged[i] = $$scope.dirty[i] | lets[i];
                }
                return merged;
            }
            return $$scope.dirty | lets;
        }
        return $$scope.dirty;
    }
    function update_slot(slot, slot_definition, ctx, $$scope, dirty, get_slot_changes_fn, get_slot_context_fn) {
        const slot_changes = get_slot_changes(slot_definition, $$scope, dirty, get_slot_changes_fn);
        if (slot_changes) {
            const slot_context = get_slot_context(slot_definition, ctx, $$scope, get_slot_context_fn);
            slot.p(slot_context, slot_changes);
        }
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function svg_element(name) {
        return document.createElementNS('http://www.w3.org/2000/svg', name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_style(node, key, value, important) {
        node.style.setProperty(key, value, important ? 'important' : '');
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const prop_values = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, prop_values, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    /* src\FaceContainer.svelte generated by Svelte v3.29.7 */

    function create_fragment(ctx) {
    	let svg;
    	let circle;
    	let g;
    	let g_transform_value;
    	let current;
    	const default_slot_template = /*#slots*/ ctx[7].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[6], null);

    	return {
    		c() {
    			svg = svg_element("svg");
    			circle = svg_element("circle");
    			g = svg_element("g");
    			if (default_slot) default_slot.c();
    			attr(circle, "r", /*faceRadius*/ ctx[4]);
    			attr(circle, "cx", /*centerX*/ ctx[2]);
    			attr(circle, "cy", /*centerY*/ ctx[3]);
    			attr(circle, "fill", fillColor);
    			attr(circle, "stroke", strokeColor);
    			attr(circle, "stroke-width", faceStrokeWidth);
    			attr(g, "transform", g_transform_value = `translate(${/*centerX*/ ctx[2]},${/*centerY*/ ctx[3]})`);
    			set_style(svg, "border", "1px solid black");
    			set_style(svg, "width", /*svgWidth*/ ctx[1] + "px");
    			set_style(svg, "height", /*svgHeight*/ ctx[0] + "px");
    		},
    		m(target, anchor) {
    			insert(target, svg, anchor);
    			append(svg, circle);
    			append(svg, g);

    			if (default_slot) {
    				default_slot.m(g, null);
    			}

    			current = true;
    		},
    		p(ctx, [dirty]) {
    			if (default_slot) {
    				if (default_slot.p && dirty & /*$$scope*/ 64) {
    					update_slot(default_slot, default_slot_template, ctx, /*$$scope*/ ctx[6], dirty, null, null);
    				}
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(svg);
    			if (default_slot) default_slot.d(detaching);
    		}
    	};
    }

    const faceStrokeWidth = 10;
    const fillColor = "yellow";
    const strokeColor = "black";

    function instance($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	let { baseParams } = $$props;
    	const svgHeight = baseParams.svgHeight;
    	const svgWidth = baseParams.svgWidth;
    	const centerX = svgWidth / 2;
    	const centerY = svgHeight / 2;
    	const faceRadius = centerX - 4 * faceStrokeWidth / 2;

    	$$self.$$set = $$props => {
    		if ("baseParams" in $$props) $$invalidate(5, baseParams = $$props.baseParams);
    		if ("$$scope" in $$props) $$invalidate(6, $$scope = $$props.$$scope);
    	};

    	return [svgHeight, svgWidth, centerX, centerY, faceRadius, baseParams, $$scope, slots];
    }

    class FaceContainer extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, { baseParams: 5 });
    	}
    }

    /* src\SmileyEyes.svelte generated by Svelte v3.29.7 */

    function create_fragment$1(ctx) {
    	let circle0;
    	let circle0_cx_value;
    	let circle0_cy_value;
    	let t;
    	let circle1;
    	let circle1_cy_value;

    	return {
    		c() {
    			circle0 = svg_element("circle");
    			t = space();
    			circle1 = svg_element("circle");
    			attr(circle0, "cx", circle0_cx_value = -eyeOffsetX);
    			attr(circle0, "cy", circle0_cy_value = -eyeOffsetY);
    			attr(circle0, "r", eyeRadius);
    			attr(circle1, "cx", eyeOffsetX);
    			attr(circle1, "cy", circle1_cy_value = -eyeOffsetY);
    			attr(circle1, "r", eyeRadius);
    		},
    		m(target, anchor) {
    			insert(target, circle0, anchor);
    			insert(target, t, anchor);
    			insert(target, circle1, anchor);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(circle0);
    			if (detaching) detach(t);
    			if (detaching) detach(circle1);
    		}
    	};
    }

    const eyeOffsetX = 65;
    const eyeOffsetY = 40;
    const eyeRadius = 35;

    class SmileyEyes extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, null, create_fragment$1, safe_not_equal, {});
    	}
    }

    const pi = Math.PI,
        tau = 2 * pi,
        epsilon = 1e-6,
        tauEpsilon = tau - epsilon;

    function Path() {
      this._x0 = this._y0 = // start of current subpath
      this._x1 = this._y1 = null; // end of current subpath
      this._ = "";
    }

    function path() {
      return new Path;
    }

    Path.prototype = path.prototype = {
      constructor: Path,
      moveTo: function(x, y) {
        this._ += "M" + (this._x0 = this._x1 = +x) + "," + (this._y0 = this._y1 = +y);
      },
      closePath: function() {
        if (this._x1 !== null) {
          this._x1 = this._x0, this._y1 = this._y0;
          this._ += "Z";
        }
      },
      lineTo: function(x, y) {
        this._ += "L" + (this._x1 = +x) + "," + (this._y1 = +y);
      },
      quadraticCurveTo: function(x1, y1, x, y) {
        this._ += "Q" + (+x1) + "," + (+y1) + "," + (this._x1 = +x) + "," + (this._y1 = +y);
      },
      bezierCurveTo: function(x1, y1, x2, y2, x, y) {
        this._ += "C" + (+x1) + "," + (+y1) + "," + (+x2) + "," + (+y2) + "," + (this._x1 = +x) + "," + (this._y1 = +y);
      },
      arcTo: function(x1, y1, x2, y2, r) {
        x1 = +x1, y1 = +y1, x2 = +x2, y2 = +y2, r = +r;
        var x0 = this._x1,
            y0 = this._y1,
            x21 = x2 - x1,
            y21 = y2 - y1,
            x01 = x0 - x1,
            y01 = y0 - y1,
            l01_2 = x01 * x01 + y01 * y01;

        // Is the radius negative? Error.
        if (r < 0) throw new Error("negative radius: " + r);

        // Is this path empty? Move to (x1,y1).
        if (this._x1 === null) {
          this._ += "M" + (this._x1 = x1) + "," + (this._y1 = y1);
        }

        // Or, is (x1,y1) coincident with (x0,y0)? Do nothing.
        else if (!(l01_2 > epsilon));

        // Or, are (x0,y0), (x1,y1) and (x2,y2) collinear?
        // Equivalently, is (x1,y1) coincident with (x2,y2)?
        // Or, is the radius zero? Line to (x1,y1).
        else if (!(Math.abs(y01 * x21 - y21 * x01) > epsilon) || !r) {
          this._ += "L" + (this._x1 = x1) + "," + (this._y1 = y1);
        }

        // Otherwise, draw an arc!
        else {
          var x20 = x2 - x0,
              y20 = y2 - y0,
              l21_2 = x21 * x21 + y21 * y21,
              l20_2 = x20 * x20 + y20 * y20,
              l21 = Math.sqrt(l21_2),
              l01 = Math.sqrt(l01_2),
              l = r * Math.tan((pi - Math.acos((l21_2 + l01_2 - l20_2) / (2 * l21 * l01))) / 2),
              t01 = l / l01,
              t21 = l / l21;

          // If the start tangent is not coincident with (x0,y0), line to.
          if (Math.abs(t01 - 1) > epsilon) {
            this._ += "L" + (x1 + t01 * x01) + "," + (y1 + t01 * y01);
          }

          this._ += "A" + r + "," + r + ",0,0," + (+(y01 * x20 > x01 * y20)) + "," + (this._x1 = x1 + t21 * x21) + "," + (this._y1 = y1 + t21 * y21);
        }
      },
      arc: function(x, y, r, a0, a1, ccw) {
        x = +x, y = +y, r = +r, ccw = !!ccw;
        var dx = r * Math.cos(a0),
            dy = r * Math.sin(a0),
            x0 = x + dx,
            y0 = y + dy,
            cw = 1 ^ ccw,
            da = ccw ? a0 - a1 : a1 - a0;

        // Is the radius negative? Error.
        if (r < 0) throw new Error("negative radius: " + r);

        // Is this path empty? Move to (x0,y0).
        if (this._x1 === null) {
          this._ += "M" + x0 + "," + y0;
        }

        // Or, is (x0,y0) not coincident with the previous point? Line to (x0,y0).
        else if (Math.abs(this._x1 - x0) > epsilon || Math.abs(this._y1 - y0) > epsilon) {
          this._ += "L" + x0 + "," + y0;
        }

        // Is this arc empty? We’re done.
        if (!r) return;

        // Does the angle go the wrong way? Flip the direction.
        if (da < 0) da = da % tau + tau;

        // Is this a complete circle? Draw two arcs to complete the circle.
        if (da > tauEpsilon) {
          this._ += "A" + r + "," + r + ",0,1," + cw + "," + (x - dx) + "," + (y - dy) + "A" + r + "," + r + ",0,1," + cw + "," + (this._x1 = x0) + "," + (this._y1 = y0);
        }

        // Is this arc non-empty? Draw an arc!
        else if (da > epsilon) {
          this._ += "A" + r + "," + r + ",0," + (+(da >= pi)) + "," + cw + "," + (this._x1 = x + r * Math.cos(a1)) + "," + (this._y1 = y + r * Math.sin(a1));
        }
      },
      rect: function(x, y, w, h) {
        this._ += "M" + (this._x0 = this._x1 = +x) + "," + (this._y0 = this._y1 = +y) + "h" + (+w) + "v" + (+h) + "h" + (-w) + "Z";
      },
      toString: function() {
        return this._;
      }
    };

    function constant(x) {
      return function constant() {
        return x;
      };
    }

    var abs = Math.abs;
    var atan2 = Math.atan2;
    var cos = Math.cos;
    var max = Math.max;
    var min = Math.min;
    var sin = Math.sin;
    var sqrt = Math.sqrt;

    var epsilon$1 = 1e-12;
    var pi$1 = Math.PI;
    var halfPi = pi$1 / 2;
    var tau$1 = 2 * pi$1;

    function acos(x) {
      return x > 1 ? 0 : x < -1 ? pi$1 : Math.acos(x);
    }

    function asin(x) {
      return x >= 1 ? halfPi : x <= -1 ? -halfPi : Math.asin(x);
    }

    function arcInnerRadius(d) {
      return d.innerRadius;
    }

    function arcOuterRadius(d) {
      return d.outerRadius;
    }

    function arcStartAngle(d) {
      return d.startAngle;
    }

    function arcEndAngle(d) {
      return d.endAngle;
    }

    function arcPadAngle(d) {
      return d && d.padAngle; // Note: optional!
    }

    function intersect(x0, y0, x1, y1, x2, y2, x3, y3) {
      var x10 = x1 - x0, y10 = y1 - y0,
          x32 = x3 - x2, y32 = y3 - y2,
          t = y32 * x10 - x32 * y10;
      if (t * t < epsilon$1) return;
      t = (x32 * (y0 - y2) - y32 * (x0 - x2)) / t;
      return [x0 + t * x10, y0 + t * y10];
    }

    // Compute perpendicular offset line of length rc.
    // http://mathworld.wolfram.com/Circle-LineIntersection.html
    function cornerTangents(x0, y0, x1, y1, r1, rc, cw) {
      var x01 = x0 - x1,
          y01 = y0 - y1,
          lo = (cw ? rc : -rc) / sqrt(x01 * x01 + y01 * y01),
          ox = lo * y01,
          oy = -lo * x01,
          x11 = x0 + ox,
          y11 = y0 + oy,
          x10 = x1 + ox,
          y10 = y1 + oy,
          x00 = (x11 + x10) / 2,
          y00 = (y11 + y10) / 2,
          dx = x10 - x11,
          dy = y10 - y11,
          d2 = dx * dx + dy * dy,
          r = r1 - rc,
          D = x11 * y10 - x10 * y11,
          d = (dy < 0 ? -1 : 1) * sqrt(max(0, r * r * d2 - D * D)),
          cx0 = (D * dy - dx * d) / d2,
          cy0 = (-D * dx - dy * d) / d2,
          cx1 = (D * dy + dx * d) / d2,
          cy1 = (-D * dx + dy * d) / d2,
          dx0 = cx0 - x00,
          dy0 = cy0 - y00,
          dx1 = cx1 - x00,
          dy1 = cy1 - y00;

      // Pick the closer of the two intersection points.
      // TODO Is there a faster way to determine which intersection to use?
      if (dx0 * dx0 + dy0 * dy0 > dx1 * dx1 + dy1 * dy1) cx0 = cx1, cy0 = cy1;

      return {
        cx: cx0,
        cy: cy0,
        x01: -ox,
        y01: -oy,
        x11: cx0 * (r1 / r - 1),
        y11: cy0 * (r1 / r - 1)
      };
    }

    function arc() {
      var innerRadius = arcInnerRadius,
          outerRadius = arcOuterRadius,
          cornerRadius = constant(0),
          padRadius = null,
          startAngle = arcStartAngle,
          endAngle = arcEndAngle,
          padAngle = arcPadAngle,
          context = null;

      function arc() {
        var buffer,
            r,
            r0 = +innerRadius.apply(this, arguments),
            r1 = +outerRadius.apply(this, arguments),
            a0 = startAngle.apply(this, arguments) - halfPi,
            a1 = endAngle.apply(this, arguments) - halfPi,
            da = abs(a1 - a0),
            cw = a1 > a0;

        if (!context) context = buffer = path();

        // Ensure that the outer radius is always larger than the inner radius.
        if (r1 < r0) r = r1, r1 = r0, r0 = r;

        // Is it a point?
        if (!(r1 > epsilon$1)) context.moveTo(0, 0);

        // Or is it a circle or annulus?
        else if (da > tau$1 - epsilon$1) {
          context.moveTo(r1 * cos(a0), r1 * sin(a0));
          context.arc(0, 0, r1, a0, a1, !cw);
          if (r0 > epsilon$1) {
            context.moveTo(r0 * cos(a1), r0 * sin(a1));
            context.arc(0, 0, r0, a1, a0, cw);
          }
        }

        // Or is it a circular or annular sector?
        else {
          var a01 = a0,
              a11 = a1,
              a00 = a0,
              a10 = a1,
              da0 = da,
              da1 = da,
              ap = padAngle.apply(this, arguments) / 2,
              rp = (ap > epsilon$1) && (padRadius ? +padRadius.apply(this, arguments) : sqrt(r0 * r0 + r1 * r1)),
              rc = min(abs(r1 - r0) / 2, +cornerRadius.apply(this, arguments)),
              rc0 = rc,
              rc1 = rc,
              t0,
              t1;

          // Apply padding? Note that since r1 ≥ r0, da1 ≥ da0.
          if (rp > epsilon$1) {
            var p0 = asin(rp / r0 * sin(ap)),
                p1 = asin(rp / r1 * sin(ap));
            if ((da0 -= p0 * 2) > epsilon$1) p0 *= (cw ? 1 : -1), a00 += p0, a10 -= p0;
            else da0 = 0, a00 = a10 = (a0 + a1) / 2;
            if ((da1 -= p1 * 2) > epsilon$1) p1 *= (cw ? 1 : -1), a01 += p1, a11 -= p1;
            else da1 = 0, a01 = a11 = (a0 + a1) / 2;
          }

          var x01 = r1 * cos(a01),
              y01 = r1 * sin(a01),
              x10 = r0 * cos(a10),
              y10 = r0 * sin(a10);

          // Apply rounded corners?
          if (rc > epsilon$1) {
            var x11 = r1 * cos(a11),
                y11 = r1 * sin(a11),
                x00 = r0 * cos(a00),
                y00 = r0 * sin(a00),
                oc;

            // Restrict the corner radius according to the sector angle.
            if (da < pi$1 && (oc = intersect(x01, y01, x00, y00, x11, y11, x10, y10))) {
              var ax = x01 - oc[0],
                  ay = y01 - oc[1],
                  bx = x11 - oc[0],
                  by = y11 - oc[1],
                  kc = 1 / sin(acos((ax * bx + ay * by) / (sqrt(ax * ax + ay * ay) * sqrt(bx * bx + by * by))) / 2),
                  lc = sqrt(oc[0] * oc[0] + oc[1] * oc[1]);
              rc0 = min(rc, (r0 - lc) / (kc - 1));
              rc1 = min(rc, (r1 - lc) / (kc + 1));
            }
          }

          // Is the sector collapsed to a line?
          if (!(da1 > epsilon$1)) context.moveTo(x01, y01);

          // Does the sector’s outer ring have rounded corners?
          else if (rc1 > epsilon$1) {
            t0 = cornerTangents(x00, y00, x01, y01, r1, rc1, cw);
            t1 = cornerTangents(x11, y11, x10, y10, r1, rc1, cw);

            context.moveTo(t0.cx + t0.x01, t0.cy + t0.y01);

            // Have the corners merged?
            if (rc1 < rc) context.arc(t0.cx, t0.cy, rc1, atan2(t0.y01, t0.x01), atan2(t1.y01, t1.x01), !cw);

            // Otherwise, draw the two corners and the ring.
            else {
              context.arc(t0.cx, t0.cy, rc1, atan2(t0.y01, t0.x01), atan2(t0.y11, t0.x11), !cw);
              context.arc(0, 0, r1, atan2(t0.cy + t0.y11, t0.cx + t0.x11), atan2(t1.cy + t1.y11, t1.cx + t1.x11), !cw);
              context.arc(t1.cx, t1.cy, rc1, atan2(t1.y11, t1.x11), atan2(t1.y01, t1.x01), !cw);
            }
          }

          // Or is the outer ring just a circular arc?
          else context.moveTo(x01, y01), context.arc(0, 0, r1, a01, a11, !cw);

          // Is there no inner ring, and it’s a circular sector?
          // Or perhaps it’s an annular sector collapsed due to padding?
          if (!(r0 > epsilon$1) || !(da0 > epsilon$1)) context.lineTo(x10, y10);

          // Does the sector’s inner ring (or point) have rounded corners?
          else if (rc0 > epsilon$1) {
            t0 = cornerTangents(x10, y10, x11, y11, r0, -rc0, cw);
            t1 = cornerTangents(x01, y01, x00, y00, r0, -rc0, cw);

            context.lineTo(t0.cx + t0.x01, t0.cy + t0.y01);

            // Have the corners merged?
            if (rc0 < rc) context.arc(t0.cx, t0.cy, rc0, atan2(t0.y01, t0.x01), atan2(t1.y01, t1.x01), !cw);

            // Otherwise, draw the two corners and the ring.
            else {
              context.arc(t0.cx, t0.cy, rc0, atan2(t0.y01, t0.x01), atan2(t0.y11, t0.x11), !cw);
              context.arc(0, 0, r0, atan2(t0.cy + t0.y11, t0.cx + t0.x11), atan2(t1.cy + t1.y11, t1.cx + t1.x11), cw);
              context.arc(t1.cx, t1.cy, rc0, atan2(t1.y11, t1.x11), atan2(t1.y01, t1.x01), !cw);
            }
          }

          // Or is the inner ring just a circular arc?
          else context.arc(0, 0, r0, a10, a00, cw);
        }

        context.closePath();

        if (buffer) return context = null, buffer + "" || null;
      }

      arc.centroid = function() {
        var r = (+innerRadius.apply(this, arguments) + +outerRadius.apply(this, arguments)) / 2,
            a = (+startAngle.apply(this, arguments) + +endAngle.apply(this, arguments)) / 2 - pi$1 / 2;
        return [cos(a) * r, sin(a) * r];
      };

      arc.innerRadius = function(_) {
        return arguments.length ? (innerRadius = typeof _ === "function" ? _ : constant(+_), arc) : innerRadius;
      };

      arc.outerRadius = function(_) {
        return arguments.length ? (outerRadius = typeof _ === "function" ? _ : constant(+_), arc) : outerRadius;
      };

      arc.cornerRadius = function(_) {
        return arguments.length ? (cornerRadius = typeof _ === "function" ? _ : constant(+_), arc) : cornerRadius;
      };

      arc.padRadius = function(_) {
        return arguments.length ? (padRadius = _ == null ? null : typeof _ === "function" ? _ : constant(+_), arc) : padRadius;
      };

      arc.startAngle = function(_) {
        return arguments.length ? (startAngle = typeof _ === "function" ? _ : constant(+_), arc) : startAngle;
      };

      arc.endAngle = function(_) {
        return arguments.length ? (endAngle = typeof _ === "function" ? _ : constant(+_), arc) : endAngle;
      };

      arc.padAngle = function(_) {
        return arguments.length ? (padAngle = typeof _ === "function" ? _ : constant(+_), arc) : padAngle;
      };

      arc.context = function(_) {
        return arguments.length ? ((context = _ == null ? null : _), arc) : context;
      };

      return arc;
    }

    function array(x) {
      return typeof x === "object" && "length" in x
        ? x // Array, TypedArray, NodeList, array-like
        : Array.from(x); // Map, Set, iterable, string, or anything else
    }

    function Linear(context) {
      this._context = context;
    }

    Linear.prototype = {
      areaStart: function() {
        this._line = 0;
      },
      areaEnd: function() {
        this._line = NaN;
      },
      lineStart: function() {
        this._point = 0;
      },
      lineEnd: function() {
        if (this._line || (this._line !== 0 && this._point === 1)) this._context.closePath();
        this._line = 1 - this._line;
      },
      point: function(x, y) {
        x = +x, y = +y;
        switch (this._point) {
          case 0: this._point = 1; this._line ? this._context.lineTo(x, y) : this._context.moveTo(x, y); break;
          case 1: this._point = 2; // proceed
          default: this._context.lineTo(x, y); break;
        }
      }
    };

    function curveLinear(context) {
      return new Linear(context);
    }

    function x(p) {
      return p[0];
    }

    function y(p) {
      return p[1];
    }

    function line(x$1, y$1) {
      var defined = constant(true),
          context = null,
          curve = curveLinear,
          output = null;

      x$1 = typeof x$1 === "function" ? x$1 : (x$1 === undefined) ? x : constant(x$1);
      y$1 = typeof y$1 === "function" ? y$1 : (y$1 === undefined) ? y : constant(y$1);

      function line(data) {
        var i,
            n = (data = array(data)).length,
            d,
            defined0 = false,
            buffer;

        if (context == null) output = curve(buffer = path());

        for (i = 0; i <= n; ++i) {
          if (!(i < n && defined(d = data[i], i, data)) === defined0) {
            if (defined0 = !defined0) output.lineStart();
            else output.lineEnd();
          }
          if (defined0) output.point(+x$1(d, i, data), +y$1(d, i, data));
        }

        if (buffer) return output = null, buffer + "" || null;
      }

      line.x = function(_) {
        return arguments.length ? (x$1 = typeof _ === "function" ? _ : constant(+_), line) : x$1;
      };

      line.y = function(_) {
        return arguments.length ? (y$1 = typeof _ === "function" ? _ : constant(+_), line) : y$1;
      };

      line.defined = function(_) {
        return arguments.length ? (defined = typeof _ === "function" ? _ : constant(!!_), line) : defined;
      };

      line.curve = function(_) {
        return arguments.length ? (curve = _, context != null && (output = curve(context)), line) : curve;
      };

      line.context = function(_) {
        return arguments.length ? (_ == null ? context = output = null : output = curve(context = _), line) : context;
      };

      return line;
    }

    /* src\SmileyMouth.svelte generated by Svelte v3.29.7 */

    function create_fragment$2(ctx) {
    	let path;
    	let path_d_value;

    	return {
    		c() {
    			path = svg_element("path");
    			attr(path, "d", path_d_value = /*mouthArc*/ ctx[0]());
    		},
    		m(target, anchor) {
    			insert(target, path, anchor);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(path);
    		}
    	};
    }

    const mouthStrokeWidth = 10;

    function instance$1($$self, $$props, $$invalidate) {
    	let { svgHeight } = $$props;
    	const mouthRadius = svgHeight / 2.9;
    	const mouthArc = arc().innerRadius(mouthRadius - mouthStrokeWidth).outerRadius(mouthRadius).startAngle(Math.PI / 2).endAngle(Math.PI * 3 / 2);

    	$$self.$$set = $$props => {
    		if ("svgHeight" in $$props) $$invalidate(1, svgHeight = $$props.svgHeight);
    	};

    	return [mouthArc, svgHeight];
    }

    class SmileyMouth extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$1, create_fragment$2, safe_not_equal, { svgHeight: 1 });
    	}
    }

    /* src\SmileyFace.svelte generated by Svelte v3.29.7 */

    function create_fragment$3(ctx) {
    	let smileyeyes;
    	let t;
    	let smileymouth;
    	let current;
    	smileyeyes = new SmileyEyes({});

    	smileymouth = new SmileyMouth({
    			props: {
    				svgHeight: /*baseParams*/ ctx[0].svgHeight
    			}
    		});

    	return {
    		c() {
    			create_component(smileyeyes.$$.fragment);
    			t = space();
    			create_component(smileymouth.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(smileyeyes, target, anchor);
    			insert(target, t, anchor);
    			mount_component(smileymouth, target, anchor);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const smileymouth_changes = {};
    			if (dirty & /*baseParams*/ 1) smileymouth_changes.svgHeight = /*baseParams*/ ctx[0].svgHeight;
    			smileymouth.$set(smileymouth_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(smileyeyes.$$.fragment, local);
    			transition_in(smileymouth.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(smileyeyes.$$.fragment, local);
    			transition_out(smileymouth.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(smileyeyes, detaching);
    			if (detaching) detach(t);
    			destroy_component(smileymouth, detaching);
    		}
    	};
    }

    function instance$2($$self, $$props, $$invalidate) {
    	let { baseParams } = $$props;

    	$$self.$$set = $$props => {
    		if ("baseParams" in $$props) $$invalidate(0, baseParams = $$props.baseParams);
    	};

    	return [baseParams];
    }

    class SmileyFace extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$2, create_fragment$3, safe_not_equal, { baseParams: 0 });
    	}
    }

    /* src\WinkyEyes.svelte generated by Svelte v3.29.7 */

    function create_fragment$4(ctx) {
    	let circle;
    	let circle_cx_value;
    	let circle_cy_value;
    	let t;
    	let path;

    	return {
    		c() {
    			circle = svg_element("circle");
    			t = space();
    			path = svg_element("path");
    			attr(circle, "cx", circle_cx_value = -eyeOffsetX$1);
    			attr(circle, "cy", circle_cy_value = -eyeOffsetY$1);
    			attr(circle, "r", eyeRadius$1);
    			attr(path, "d", /*eyeline*/ ctx[0]);
    			attr(path, "stroke", "black");
    			attr(path, "stroke-width", mouthStrokeWidth$1);
    			attr(path, "fill", "none");
    		},
    		m(target, anchor) {
    			insert(target, circle, anchor);
    			insert(target, t, anchor);
    			insert(target, path, anchor);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(circle);
    			if (detaching) detach(t);
    			if (detaching) detach(path);
    		}
    	};
    }

    const eyeOffsetX$1 = 65;
    const eyeOffsetY$1 = 40;
    const eyeRadius$1 = 35;
    const mouthStrokeWidth$1 = 10;

    function instance$3($$self) {
    	let eyeline = line()([
    		[eyeOffsetX$1 - eyeRadius$1, 0 - eyeOffsetY$1],
    		[eyeOffsetX$1 + eyeRadius$1, 0 - eyeOffsetY$1]
    	]);

    	return [eyeline];
    }

    class WinkyEyes extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$3, create_fragment$4, safe_not_equal, {});
    	}
    }

    /* src\WinkyMouth.svelte generated by Svelte v3.29.7 */

    function create_fragment$5(ctx) {
    	let path0;
    	let path0_d_value;
    	let t;
    	let g;
    	let path1;
    	let path1_d_value;
    	let g_transform_value;

    	return {
    		c() {
    			path0 = svg_element("path");
    			t = space();
    			g = svg_element("g");
    			path1 = svg_element("path");
    			attr(path0, "d", path0_d_value = /*mouthArc*/ ctx[0]());
    			attr(path1, "d", path1_d_value = /*dimpleArc*/ ctx[1]());
    			attr(g, "transform", g_transform_value = `translate(${dimpleTransformX},${dimpleTransformY})`);
    		},
    		m(target, anchor) {
    			insert(target, path0, anchor);
    			insert(target, t, anchor);
    			insert(target, g, anchor);
    			append(g, path1);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(path0);
    			if (detaching) detach(t);
    			if (detaching) detach(g);
    		}
    	};
    }

    const mouthStrokeWidth$2 = 10;
    const dimpleTransformX = 155;
    const dimpleTransformY = 42;

    function instance$4($$self, $$props, $$invalidate) {
    	let { svgHeight } = $$props;
    	const mouthRadius = svgHeight / 2.9;
    	const dimpleRadius = mouthRadius / 4;
    	const mouthDimpleAngle = Math.PI / 1.525;
    	const mouthArc = arc().innerRadius(mouthRadius - mouthStrokeWidth$2).outerRadius(mouthRadius).startAngle(mouthDimpleAngle).endAngle(Math.PI * 3 / 2);
    	const dimpleArc = arc().innerRadius(dimpleRadius - mouthStrokeWidth$2).outerRadius(dimpleRadius).startAngle(mouthDimpleAngle).endAngle(Math.PI * 3 / 2);

    	$$self.$$set = $$props => {
    		if ("svgHeight" in $$props) $$invalidate(2, svgHeight = $$props.svgHeight);
    	};

    	return [mouthArc, dimpleArc, svgHeight];
    }

    class WinkyMouth extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$4, create_fragment$5, safe_not_equal, { svgHeight: 2 });
    	}
    }

    /* src\WinkyFace.svelte generated by Svelte v3.29.7 */

    function create_fragment$6(ctx) {
    	let winkyeyes;
    	let t;
    	let winkymouth;
    	let current;
    	winkyeyes = new WinkyEyes({});

    	winkymouth = new WinkyMouth({
    			props: {
    				svgHeight: /*baseParams*/ ctx[0].svgHeight
    			}
    		});

    	return {
    		c() {
    			create_component(winkyeyes.$$.fragment);
    			t = space();
    			create_component(winkymouth.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(winkyeyes, target, anchor);
    			insert(target, t, anchor);
    			mount_component(winkymouth, target, anchor);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const winkymouth_changes = {};
    			if (dirty & /*baseParams*/ 1) winkymouth_changes.svgHeight = /*baseParams*/ ctx[0].svgHeight;
    			winkymouth.$set(winkymouth_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(winkyeyes.$$.fragment, local);
    			transition_in(winkymouth.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(winkyeyes.$$.fragment, local);
    			transition_out(winkymouth.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(winkyeyes, detaching);
    			if (detaching) detach(t);
    			destroy_component(winkymouth, detaching);
    		}
    	};
    }

    function instance$5($$self, $$props, $$invalidate) {
    	let { baseParams } = $$props;

    	$$self.$$set = $$props => {
    		if ("baseParams" in $$props) $$invalidate(0, baseParams = $$props.baseParams);
    	};

    	return [baseParams];
    }

    class WinkyFace extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$5, create_fragment$6, safe_not_equal, { baseParams: 0 });
    	}
    }

    /* src\App.svelte generated by Svelte v3.29.7 */

    function create_default_slot_1(ctx) {
    	let smileyface;
    	let current;

    	smileyface = new SmileyFace({
    			props: { baseParams: /*baseParams*/ ctx[0] }
    		});

    	return {
    		c() {
    			create_component(smileyface.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(smileyface, target, anchor);
    			current = true;
    		},
    		p: noop,
    		i(local) {
    			if (current) return;
    			transition_in(smileyface.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(smileyface.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(smileyface, detaching);
    		}
    	};
    }

    // (20:2) <FaceContainer {baseParams} >
    function create_default_slot(ctx) {
    	let winkyface;
    	let current;

    	winkyface = new WinkyFace({
    			props: { baseParams: /*baseParams*/ ctx[0] }
    		});

    	return {
    		c() {
    			create_component(winkyface.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(winkyface, target, anchor);
    			current = true;
    		},
    		p: noop,
    		i(local) {
    			if (current) return;
    			transition_in(winkyface.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(winkyface.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(winkyface, detaching);
    		}
    	};
    }

    function create_fragment$7(ctx) {
    	let h1;
    	let t1;
    	let div;
    	let facecontainer0;
    	let t2;
    	let facecontainer1;
    	let current;

    	facecontainer0 = new FaceContainer({
    			props: {
    				baseParams: /*baseParams*/ ctx[0],
    				$$slots: { default: [create_default_slot_1] },
    				$$scope: { ctx }
    			}
    		});

    	facecontainer1 = new FaceContainer({
    			props: {
    				baseParams: /*baseParams*/ ctx[0],
    				$$slots: { default: [create_default_slot] },
    				$$scope: { ctx }
    			}
    		});

    	return {
    		c() {
    			h1 = element("h1");
    			h1.textContent = "Smiley Face and Winky Face built with rollup, svelte, svg, and d3";
    			t1 = space();
    			div = element("div");
    			create_component(facecontainer0.$$.fragment);
    			t2 = space();
    			create_component(facecontainer1.$$.fragment);
    		},
    		m(target, anchor) {
    			insert(target, h1, anchor);
    			insert(target, t1, anchor);
    			insert(target, div, anchor);
    			mount_component(facecontainer0, div, null);
    			append(div, t2);
    			mount_component(facecontainer1, div, null);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const facecontainer0_changes = {};

    			if (dirty & /*$$scope*/ 2) {
    				facecontainer0_changes.$$scope = { dirty, ctx };
    			}

    			facecontainer0.$set(facecontainer0_changes);
    			const facecontainer1_changes = {};

    			if (dirty & /*$$scope*/ 2) {
    				facecontainer1_changes.$$scope = { dirty, ctx };
    			}

    			facecontainer1.$set(facecontainer1_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(facecontainer0.$$.fragment, local);
    			transition_in(facecontainer1.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(facecontainer0.$$.fragment, local);
    			transition_out(facecontainer1.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(h1);
    			if (detaching) detach(t1);
    			if (detaching) detach(div);
    			destroy_component(facecontainer0);
    			destroy_component(facecontainer1);
    		}
    	};
    }

    function instance$6($$self) {
    	const baseParams = { svgHeight: 480, svgWidth: 480 };
    	return [baseParams];
    }

    class App extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$6, create_fragment$7, safe_not_equal, {});
    	}
    }

    const svelteApp = new App({
      target: document.body,
    });

}());
