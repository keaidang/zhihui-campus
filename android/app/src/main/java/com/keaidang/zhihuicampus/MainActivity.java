package com.keaidang.zhihuicampus;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * 硬件 / 手势返回键处理（2026-10-15 修复）。
     *
     * 问题：Capacitor 7 在**未安装 @capacitor/app 插件**时，返回键走 Android 默认实现，
     * 直接 finish 掉当前 Activity —— 表现为「一按返回就退出应用」，无法回到上一级菜单。
     *
     * 方案：注册 OnBackPressedCallback，优先让 WebView 自己回退（等价浏览器的「后退」，
     * 前端是 Vue Router history 模式，goBack 会触发 popstate 正常切回上一路由）；
     * 只有当确实没有可回退的页面历史时，才交回系统默认行为（退出应用/回到桌面）。
     *
     * 这样无需引入 @capacitor/app 依赖，也不必改前端（壳加载的是线上站点，前端改动还需重新部署）。
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getOnBackPressedDispatcher().addCallback(
            this,
            new OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                    if (webView != null && webView.canGoBack()) {
                        webView.goBack();
                        return;
                    }
                    // 已到首页/无历史：临时禁用本回调，交回系统默认（退出应用）
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    setEnabled(true);
                }
            }
        );
    }
}

