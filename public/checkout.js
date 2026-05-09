(function () {
  "use strict";

  var DEFAULT_BASE_URL = "https://ottoauth.vercel.app";
  var currentScript = document.currentScript;
  var scriptBaseUrl = DEFAULT_BASE_URL;

  try {
    if (currentScript && currentScript.src) {
      scriptBaseUrl = new URL(currentScript.src).origin;
    }
  } catch (_error) {
    scriptBaseUrl = DEFAULT_BASE_URL;
  }

  function optionalString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : "";
  }

  function dollarsToCents(value) {
    if (value == null || value === "") return undefined;
    var amount =
      typeof value === "number"
        ? value
        : Number(String(value).replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) return undefined;
    return Math.round(amount * 100);
  }

  function toSnakeOrder(order) {
    var next = Object.assign({}, order || {});
    if (next.maxChargeCents != null && next.max_charge_cents == null) {
      next.max_charge_cents = next.maxChargeCents;
      delete next.maxChargeCents;
    }
    if (next.taskTitle != null && next.task_title == null) {
      next.task_title = next.taskTitle;
      delete next.taskTitle;
    }
    if (next.shippingAddress != null && next.shipping_address == null) {
      next.shipping_address = next.shippingAddress;
      delete next.shippingAddress;
    }
    if (next.merchantName != null && next.merchant_name == null) {
      next.merchant_name = next.merchantName;
      delete next.merchantName;
    }
    return next;
  }

  function fromShorthand(options) {
    var opts = Object.assign({}, options || {});
    var order = toSnakeOrder(opts.order || {});

    if (opts.title != null && order.task_title == null) {
      order.task_title = opts.title;
    }
    if (opts.task != null && order.task == null) {
      order.task = opts.task;
    }
    if (opts.max != null && order.max_charge_cents == null) {
      order.max_charge_cents = opts.max;
    }
    if (opts.maxCents != null && order.max_charge_cents == null) {
      order.max_charge_cents = opts.maxCents;
    }
    if (opts.maxUsd != null && order.max_charge_cents == null) {
      order.max_charge_cents = dollarsToCents(opts.maxUsd);
    }
    if (opts.maxDollars != null && order.max_charge_cents == null) {
      order.max_charge_cents = dollarsToCents(opts.maxDollars);
    }
    if (opts.merchant != null && order.merchant == null) {
      order.merchant = opts.merchant;
    }
    if (opts.item != null && order.item_name == null) {
      order.item_name = opts.item;
    }
    if (opts.itemName != null && order.item_name == null) {
      order.item_name = opts.itemName;
    }
    if (opts.quantity != null && order.quantity == null) {
      order.quantity = opts.quantity;
    }
    if (opts.shipping != null && order.shipping_address == null) {
      order.shipping_address = opts.shipping;
    }
    if (opts.shippingAddress != null && order.shipping_address == null) {
      order.shipping_address = opts.shippingAddress;
    }
    if (opts.quote != null && order.quote == null) {
      order.quote = opts.quote;
    }
    if (opts.details != null && order.order_details == null) {
      order.order_details = Array.isArray(opts.details) ? opts.details.join("\n") : opts.details;
    }
    if (opts.metadata != null && order.metadata == null) {
      order.metadata = opts.metadata;
    }

    return Object.assign({}, opts, {
      appId: optionalString(opts.appId) || optionalString(opts.app),
      appName: optionalString(opts.appName) || optionalString(opts.app),
      maxChargeCents: opts.maxChargeCents == null ? opts.max ?? opts.maxCents : opts.maxChargeCents,
      order: order,
    });
  }

  function bytesToBase64(bytes) {
    var binary = "";
    var chunkSize = 0x8000;
    for (var offset = 0; offset < bytes.length; offset += chunkSize) {
      var chunk = bytes.subarray(offset, offset + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  function textToBase64(text) {
    return bytesToBase64(new TextEncoder().encode(String(text || "")));
  }

  function serializeSvgElement(element) {
    var svg = new XMLSerializer().serializeToString(element);
    if (!/xmlns=/.test(svg)) {
      svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    return svg;
  }

  function readBlobAsBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var result = String(reader.result || "");
        resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
      };
      reader.onerror = function () {
        reject(reader.error || new Error("Could not read checkout file."));
      };
      reader.readAsDataURL(blob);
    });
  }

  async function normalizeFile(file) {
    if (typeof file === "string") {
      var selected = document.querySelector(file);
      if (selected) {
        return normalizeFile({
          name: selected.id ? selected.id + ".svg" : "checkout-file.svg",
          svgElement: selected,
          contentType: "image/svg+xml",
        });
      }
      return { url: file };
    }

    if (typeof Element !== "undefined" && file instanceof Element) {
      return normalizeFile({
        name: file.id ? file.id + ".svg" : "checkout-file.svg",
        svgElement: file,
        contentType: "image/svg+xml",
      });
    }

    if (typeof Blob !== "undefined" && file instanceof Blob) {
      return normalizeFile({ file: file });
    }

    if (!file || typeof file !== "object") {
      throw new Error("Checkout files must be objects.");
    }

    var next = Object.assign({}, file);
    var blob = file.blob || file.file;
    var element = file.svgElement || file.element;
    var content = file.content;

    if (file.contentType && !next.content_type) {
      next.content_type = file.contentType;
      delete next.contentType;
    }
    if (file.contentBase64 && !next.content_base64) {
      next.content_base64 = file.contentBase64;
      delete next.contentBase64;
    }
    if (file.downloadUrl && !next.download_url) {
      next.download_url = file.downloadUrl;
      delete next.downloadUrl;
    }

    delete next.blob;
    delete next.file;
    delete next.content;
    delete next.svgElement;
    delete next.element;

    if (next.content_base64) return next;
    if (blob instanceof Blob) {
      next.name = optionalString(next.name) || optionalString(blob.name) || "checkout-file";
      next.content_type =
        optionalString(next.content_type) || optionalString(blob.type) || "application/octet-stream";
      next.content_base64 = await readBlobAsBase64(blob);
      next.size = blob.size;
      return next;
    }
    if (element) {
      content = serializeSvgElement(element);
      next.content_type = optionalString(next.content_type) || "image/svg+xml";
    }
    if (content != null) {
      next.name = optionalString(next.name) || "checkout-file";
      next.content_type = optionalString(next.content_type) || "text/plain";
      next.content_base64 = textToBase64(content);
      next.size = new TextEncoder().encode(String(content)).length;
      return next;
    }
    return next;
  }

  async function normalizeFiles(files) {
    var list = Array.isArray(files) ? files : files ? [files] : [];
    var normalized = [];
    for (var index = 0; index < list.length; index += 1) {
      normalized.push(await normalizeFile(list[index]));
    }
    return normalized;
  }

  function returnUrl(defaultStatus) {
    var url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    return (
      url.href +
      "?ottoauth_checkout=" +
      encodeURIComponent(defaultStatus) +
      "&session_id={CHECKOUT_SESSION_ID}&order_id={ORDER_ID}&task_id={TASK_ID}"
    );
  }

  function CheckoutClient(config) {
    this.config = Object.assign({}, config || {});
    this.baseUrl = optionalString(this.config.baseUrl) || scriptBaseUrl;
    this.baseUrl = this.baseUrl.replace(/\/+$/, "");
  }

  CheckoutClient.prototype.buildSessionBody = async function (options) {
    var opts = Object.assign({}, options || {});
    var order = toSnakeOrder(opts.order || opts);
    var files = await normalizeFiles(opts.files || order.files);
    if (files.length) order.files = files;

    if (opts.maxChargeCents != null && order.max_charge_cents == null) {
      order.max_charge_cents = opts.maxChargeCents;
    }

    var body = {
      auth_mode: "human_session",
      app_id: optionalString(opts.appId) || optionalString(this.config.appId) || "local-app",
      app_name: optionalString(opts.appName) || optionalString(this.config.appName) || "Local app",
      success_url:
        optionalString(opts.successUrl) || optionalString(this.config.successUrl) || returnUrl("success"),
      cancel_url:
        optionalString(opts.cancelUrl) || optionalString(this.config.cancelUrl) || returnUrl("canceled"),
      external_id: optionalString(opts.externalId) || undefined,
      metadata: Object.assign({}, this.config.metadata || {}, opts.metadata || {}),
      order: order,
    };
    return body;
  };

  CheckoutClient.prototype.createSession = async function (options) {
    var body = await this.buildSessionBody(options);

    var response = await fetch(this.baseUrl + "/v1/checkout/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    var payload = await response.json().catch(function () {
      return null;
    });
    if (!response.ok) {
      var message = payload && payload.error ? payload.error : "OttoAuth checkout failed.";
      var error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  };

  function submitCheckoutHandoff(action, body) {
    if (!document || !document.createElement) {
      throw new Error("OttoAuth browser checkout requires a document.");
    }
    var form = document.createElement("form");
    form.method = "POST";
    form.action = action;
    form.enctype = "application/x-www-form-urlencoded";
    form.acceptCharset = "UTF-8";
    form.style.display = "none";

    var payload = document.createElement("textarea");
    payload.name = "payload";
    payload.value = JSON.stringify(body);
    form.appendChild(payload);

    (document.body || document.documentElement).appendChild(form);
    if (window.HTMLFormElement && window.HTMLFormElement.prototype.submit) {
      window.HTMLFormElement.prototype.submit.call(form);
    } else {
      form.submit();
    }

    return {
      ok: true,
      handoff: true,
      url: action,
    };
  }

  CheckoutClient.prototype.handoffToCheckout = async function (options) {
    var body = await this.buildSessionBody(options);
    return submitCheckoutHandoff(this.baseUrl + "/checkout/import/browser", body);
  };

  CheckoutClient.prototype.redirectToCheckout = async function (options) {
    var payload = await this.createSession(options);
    var checkoutUrl =
      payload && (payload.url || (payload.session && payload.session.url));
    if (!checkoutUrl) throw new Error("OttoAuth did not return a checkout URL.");
    if (!options || options.redirect !== false) {
      window.location.assign(checkoutUrl);
    }
    return payload;
  };

  function init(config) {
    return new CheckoutClient(config);
  }

  function buy(options) {
    var normalized = fromShorthand(options);
    var client = init({
      baseUrl: normalized.baseUrl,
      appId: normalized.appId,
      appName: normalized.appName,
      successUrl: normalized.successUrl,
      cancelUrl: normalized.cancelUrl,
      metadata: normalized.metadata,
    });
    if (
      normalized.redirect === false ||
      normalized.transport === "fetch" ||
      normalized.mode === "fetch"
    ) {
      return client.redirectToCheckout(normalized);
    }
    return client.handoffToCheckout(normalized);
  }

  window.OttoAuthCheckout = {
    init: init,
    createSession: function (options) {
      return init({}).createSession(options);
    },
    redirectToCheckout: function (options) {
      return init({}).redirectToCheckout(options);
    },
  };

  window.OttoAuth = {
    buy: buy,
    checkout: buy,
    init: init,
    createSession: function (options) {
      return init({}).createSession(fromShorthand(options));
    },
    redirectToCheckout: function (options) {
      return init({}).redirectToCheckout(fromShorthand(options));
    },
  };
})();
