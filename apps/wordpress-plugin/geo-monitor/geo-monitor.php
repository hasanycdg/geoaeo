<?php
/**
 * Plugin Name:       GEO Monitor
 * Description:        Track how AI assistants (ChatGPT, Claude, Gemini, Perplexity) recommend your store, and fix what holds you back. Powered by the shared GEO backend.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            GEO Monitor
 * License:           GPL-2.0-or-later
 * Text Domain:       geo-monitor
 *
 * Zero-config: on activation the plugin provisions itself against the managed
 * GEO backend using a WP Application Password. The heavy logic (LLM scans,
 * analysis, audits, billing) lives in the backend — this plugin is a thin client.
 */

if (!defined('ABSPATH')) {
    exit;
}

// Managed backend base URL. Override in wp-config.php with:
//   define('GEO_BACKEND_URL', 'https://api.your-domain.com');
if (!defined('GEO_BACKEND_URL')) {
    define('GEO_BACKEND_URL', 'https://api.getbrandradar.com');
}

define('GEO_MONITOR_VERSION', '1.0.0');
define('GEO_MONITOR_DIR', plugin_dir_path(__FILE__));

require_once GEO_MONITOR_DIR . 'includes/class-geo-client.php';
require_once GEO_MONITOR_DIR . 'includes/class-geo-admin.php';
require_once GEO_MONITOR_DIR . 'includes/class-geo-rest.php';

/**
 * Activation: mint an Application Password for the current admin and register
 * this site with the backend. Stores the returned API key + tenant id.
 */
function geo_monitor_activate() {
    $user_id = get_current_user_id();
    if (!$user_id) {
        return; // provisioning retried from the admin page (see Geo_Admin::maybe_provision)
    }
    Geo_Monitor_Provisioning::provision($user_id);
}
register_activation_hook(__FILE__, 'geo_monitor_activate');

/**
 * Provisioning helper — also callable from the admin page if activation ran in a
 * context without a user (e.g. WP-CLI).
 */
class Geo_Monitor_Provisioning {
    public static function provision($user_id) {
        if (get_option('geo_monitor_api_key')) {
            return true; // already provisioned
        }
        if (!class_exists('WP_Application_Passwords')) {
            return false;
        }
        $created = WP_Application_Passwords::create_new_application_password(
            $user_id,
            array('name' => 'GEO Monitor ' . gmdate('Y-m-d'))
        );
        if (is_wp_error($created)) {
            return false;
        }
        $app_password = $created[0]; // plaintext, only available here
        $user = get_userdata($user_id);

        $client = new Geo_Client();
        $res = $client->register(get_userdata($user_id)->user_login, $app_password);
        if (is_wp_error($res) || empty($res['apiKey'])) {
            return false;
        }
        update_option('geo_monitor_api_key', $res['apiKey'], false);
        update_option('geo_monitor_tenant_id', $res['tenantId'], false);
        update_option('geo_monitor_plan', isset($res['plan']) ? $res['plan'] : 'FREE', false);
        return true;
    }
}

// Boot the admin UI and REST routes.
add_action('plugins_loaded', function () {
    if (is_admin()) {
        new Geo_Admin();
    }
    new Geo_Rest();
});
