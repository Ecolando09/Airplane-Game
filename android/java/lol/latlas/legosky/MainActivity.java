package lol.latlas.legosky;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.DownloadListener;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Lego Sky: shows the live game from play.latlas.lol full screen and in landscape.
 * Pages on play.latlas.lol stay in the app; other links open in the browser.
 *
 * The same code builds the PSG1 app (deploy/build-apk.sh OUT.apk psg1), which sets
 * the resource bool "psg1". That app carries the whole game inside it (the PSG1
 * build from `npm run build:psg1`, in assets/game/) and serves it to the web view
 * from https://appassets.androidplatform.net/, so it plays with no internet. When
 * online, the game itself reaches play.latlas.lol for multiplayer rooms and
 * leaderboards. It also tags its user agent "LegoSkyPSG1/1" and passes the
 * built-in buttons and sticks to the page (window.legoSkyPad), so they always
 * work and B never acts as Back.
 */
public class MainActivity extends Activity {
    static final String HOST = "play.latlas.lol";
    static final String SITE = "https://" + HOST + "/legoplane/";
    // Lets the game know it runs inside the app (and which app version).
    static final String UA_TAG = " LegoSkyApp/1";
    static final String PSG1_TAG = " LegoSkyPSG1/1";
    // The address the built-in copy of the game is served at (reserved for apps).
    static final String ASSET_HOST = "appassets.androidplatform.net";

    private boolean psg1;
    private String home = SITE;
    // The gamepad's state in the browser's standard order: buttons 0 bottom,
    // 1 right, 2 left, 3 top, 4/5 shoulders, 6/7 triggers, 8 select, 9 start,
    // 10/11 stick clicks, 12-15 D-pad up/down/left/right; axes 0-3 the two sticks.
    private final float[] buttons = new float[17];
    private final float[] axes = new float[4];

    private FrameLayout root;
    private WebView web;
    private TextView error;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        psg1 = getResources().getBoolean(R.bool.psg1);
        if (psg1) home = "https://" + ASSET_HOST + "/index.html";
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            w.getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(0x1b, 0x2a, 0x34));
        error = new TextView(this);
        error.setText("Can't reach play.latlas.lol.\nCheck your internet connection, then tap to try again.");
        error.setTextColor(Color.WHITE);
        error.setTextSize(20);
        error.setGravity(Gravity.CENTER);
        error.setPadding(48, 48, 48, 48);
        error.setVisibility(View.GONE);
        error.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                error.setVisibility(View.GONE);
                web.loadUrl(home);
            }
        });
        setContentView(root);
        createWebView();
        root.addView(error, new FrameLayout.LayoutParams(-1, -1));

        if (saved == null || web.restoreState(saved) == null) web.loadUrl(home);
    }

    private void createWebView() {
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(0x1b, 0x2a, 0x34));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + UA_TAG + (psg1 ? PSG1_TAG : ""));
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (psg1 && ASSET_HOST.equals(u.getHost())) return false;
                if (HOST.equals(u.getHost()) && !u.getPath().endsWith(".apk")) return false;
                openOutside(u);
                return true;
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!psg1 || !ASSET_HOST.equals(u.getHost())) return null; // everything else: the network
                return serveAsset(u.getPath());
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame() && !psg1) error.setVisibility(View.VISIBLE);
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // The page's renderer died (usually out of memory): start a fresh one.
                root.removeView(web);
                web.destroy();
                createWebView();
                web.loadUrl(home);
                return true;
            }
        });
        // Downloads (like a newer APK) go to the browser, which knows how to save them.
        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String ua, String disposition, String mime, long length) {
                openOutside(Uri.parse(url));
            }
        });
        root.addView(web, 0, new FrameLayout.LayoutParams(-1, -1));
    }

    // ------------------------------------------------------------ built-in game (PSG1)
    private static String mimeFor(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".webp")) return "image/webp";
        return "application/octet-stream";
    }

    /** A file from assets/game/, or a 404. */
    private WebResourceResponse serveAsset(String path) {
        if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
        if (path.contains("..")) return notFound();
        Map<String, String> headers = new HashMap<String, String>();
        headers.put("Cache-Control", "no-cache");
        headers.put("Access-Control-Allow-Origin", "*");
        try {
            InputStream in = getAssets().open("game" + path);
            String mime = mimeFor(path);
            String enc = mime.startsWith("text/") || mime.endsWith("json") ? "utf-8" : null;
            return new WebResourceResponse(mime, enc, 200, "OK", headers, in);
        } catch (IOException e) {
            return notFound();
        }
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<String, String>(),
            new ByteArrayInputStream(new byte[0]));
    }

    // ------------------------------------------------------------ PSG1 controls
    /** Standard gamepad button number for an Android key code, or -1. */
    private static int buttonFor(int key) {
        switch (key) {
            case KeyEvent.KEYCODE_BUTTON_A: return 0; // bottom (printed "B" on the PSG1)
            case KeyEvent.KEYCODE_BUTTON_B: return 1; // right (printed "A")
            case KeyEvent.KEYCODE_BUTTON_X: return 2; // left (printed "Y")
            case KeyEvent.KEYCODE_BUTTON_Y: return 3; // top (printed "X")
            case KeyEvent.KEYCODE_BUTTON_L1: return 4;
            case KeyEvent.KEYCODE_BUTTON_R1: return 5;
            case KeyEvent.KEYCODE_BUTTON_L2: return 6;
            case KeyEvent.KEYCODE_BUTTON_R2: return 7;
            case KeyEvent.KEYCODE_BUTTON_SELECT: return 8;
            case KeyEvent.KEYCODE_BUTTON_START: return 9;
            case KeyEvent.KEYCODE_BUTTON_THUMBL: return 10;
            case KeyEvent.KEYCODE_BUTTON_THUMBR: return 11;
            case KeyEvent.KEYCODE_DPAD_UP: return 12;
            case KeyEvent.KEYCODE_DPAD_DOWN: return 13;
            case KeyEvent.KEYCODE_DPAD_LEFT: return 14;
            case KeyEvent.KEYCODE_DPAD_RIGHT: return 15;
            case KeyEvent.KEYCODE_BUTTON_MODE: return 16;
            default: return -1;
        }
    }

    private static boolean fromPad(InputDevice d, int source) {
        int s = d != null ? d.getSources() : source;
        return (s & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD
            || (s & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK
            || (s & InputDevice.SOURCE_DPAD) == InputDevice.SOURCE_DPAD;
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        if (psg1 && web != null) {
            int b = buttonFor(e.getKeyCode());
            if (b >= 0 && fromPad(e.getDevice(), e.getSource())) {
                if (e.getAction() == KeyEvent.ACTION_DOWN) buttons[b] = 1;
                else if (e.getAction() == KeyEvent.ACTION_UP) buttons[b] = 0;
                if (e.getRepeatCount() == 0) {
                    sendPad();
                    // The raw key code too, for the device check page (which button sends what).
                    web.evaluateJavascript("window.legoSkyKey&&window.legoSkyKey(" + e.getKeyCode() + ","
                        + (e.getAction() == KeyEvent.ACTION_DOWN) + "," + b + ")", null);
                }
                return true; // handled here: B must not become Back, the D-pad must not scroll
            }
        }
        return super.dispatchKeyEvent(e);
    }

    private static float axis(MotionEvent e, int a) {
        float v = e.getAxisValue(a);
        return Math.abs(v) < 0.05f ? 0 : v;
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent e) {
        if (psg1 && web != null && e.getAction() == MotionEvent.ACTION_MOVE
            && ((e.getSource() & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK)) {
            axes[0] = axis(e, MotionEvent.AXIS_X);
            axes[1] = axis(e, MotionEvent.AXIS_Y);
            axes[2] = axis(e, MotionEvent.AXIS_Z);
            axes[3] = axis(e, MotionEvent.AXIS_RZ);
            buttons[6] = Math.max(axis(e, MotionEvent.AXIS_LTRIGGER), axis(e, MotionEvent.AXIS_BRAKE));
            buttons[7] = Math.max(axis(e, MotionEvent.AXIS_RTRIGGER), axis(e, MotionEvent.AXIS_GAS));
            // Some pads report the D-pad as a hat (two axes) instead of keys.
            float hx = e.getAxisValue(MotionEvent.AXIS_HAT_X);
            float hy = e.getAxisValue(MotionEvent.AXIS_HAT_Y);
            if (hx != 0 || hy != 0 || hatWasOn) {
                buttons[12] = hy < -0.5f ? 1 : 0;
                buttons[13] = hy > 0.5f ? 1 : 0;
                buttons[14] = hx < -0.5f ? 1 : 0;
                buttons[15] = hx > 0.5f ? 1 : 0;
                hatWasOn = hx != 0 || hy != 0;
            }
            sendPad();
            return true;
        }
        return super.dispatchGenericMotionEvent(e);
    }

    private boolean hatWasOn;

    /** Hand the current state to the page's virtual gamepad. */
    private void sendPad() {
        StringBuilder js = new StringBuilder("window.legoSkyPad&&window.legoSkyPad.set([");
        for (int i = 0; i < buttons.length; i++) js.append(i > 0 ? "," : "").append(buttons[i]);
        js.append("],[");
        for (int i = 0; i < axes.length; i++) js.append(i > 0 ? "," : "").append(axes[i]);
        js.append("],true)");
        web.evaluateJavascript(js.toString(), null);
    }

    private void openOutside(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (ActivityNotFoundException ignored) {
        }
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    /** Back while flying opens the game menu; back from the menu leaves the app. */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("window.legoSkyBack ? window.legoSkyBack() : false", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String handled) {
                if ("true".equals(handled)) return;
                if (web.canGoBack()) web.goBack();
                else finish();
            }
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
