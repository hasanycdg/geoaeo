<?php
/**
 * Plugin Name:       GEO Monitor
 * Description:        Track how AI assistants (ChatGPT, Claude, Gemini, Perplexity) recommend your store, and fix what holds you back. Powered by the shared GEO backend.
 * Version:           1.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            GEO Monitor
 * License:           GPL-2.0-or-later
 * Text Domain:       geo-monitor
 *
 * Zero-config PUSH model: the plugin runs inside WordPress and pushes the store
 * profile + catalog to the managed GEO backend. Provisioning proves control of
 * the domain via a public token (served at /?geo_verify=1) — NO REST API access
 * is required, so it works on locked-down / managed WordPress hosts too.
 */

if (!defined('ABSPATH')) {
    exit;
}

// Managed backend base URL. Override in wp-config.php with:
//   define('GEO_BACKEND_URL', 'https://api.your-domain.com');
if (!defined('GEO_BACKEND_URL')) {
    define('GEO_BACKEND_URL', 'https://api.getbrandradar.com');
}

define('GEO_MONITOR_VERSION', '1.1.0');
define('GEO_MONITOR_DIR', plugin_dir_path(__FILE__));
define('GEO_MONITOR_URL', plugin_dir_url(__FILE__));

require_once GEO_MONITOR_DIR . 'includes/class-geo-client.php';
require_once GEO_MONITOR_DIR . 'includes/class-geo-sync.php';
require_once GEO_MONITOR_DIR . 'includes/class-geo-admin.php';
require_once GEO_MONITOR_DIR . 'includes/class-geo-rest.php';

/**
 * Provisioning: prove control of this domain to the backend with a public token,
 * store the returned API key, and push the first catalog snapshot.
 */
class Geo_Provisioning {
    public static function provision() {
        if (get_option('geo_monitor_api_key')) {
            return true; // already provisioned
        }
        $token = get_option('geo_monitor_verify_token');
        if (!$token) {
            $token = wp_generate_password(40, false, false);
            update_option('geo_monitor_verify_token', $token, false);
        }
        $client = new Geo_Client();
        $res = $client->register(rtrim(get_site_url(), '/'), $token);
        if (is_wp_error($res) || empty($res['apiKey'])) {
            return false;
        }
        update_option('geo_monitor_api_key', $res['apiKey'], false);
        update_option('geo_monitor_tenant_id', isset($res['tenantId']) ? $res['tenantId'] : '', false);
        update_option('geo_monitor_plan', isset($res['plan']) ? $res['plan'] : 'FREE', false);
        Geo_Sync::push(); // initial catalog + profile
        return true;
    }
}

/**
 * Activation: register the /llms.txt rewrite (+flush), provision against the
 * backend, and schedule the daily catalog sync.
 */
function geo_monitor_activate() {
    add_rewrite_rule('^llms\.txt$', 'index.php?geo_llms=1', 'top');
    flush_rewrite_rules();
    Geo_Provisioning::provision();
    if (!wp_next_scheduled('geo_monitor_sync')) {
        wp_schedule_event(time() + 300, 'daily', 'geo_monitor_sync');
    }
}
register_activation_hook(__FILE__, 'geo_monitor_activate');

function geo_monitor_deactivate() {
    wp_clear_scheduled_hook('geo_monitor_sync');
    flush_rewrite_rules();
}
register_deactivation_hook(__FILE__, 'geo_monitor_deactivate');

// Daily cron: push a fresh catalog snapshot to the backend.
add_action('geo_monitor_sync', function () {
    Geo_Sync::push();
});

// Boot the admin UI and public routes.
add_action('plugins_loaded', function () {
    if (is_admin()) {
        new Geo_Admin();
    }
    new Geo_Rest();
});
