<?php
/**
 * REST + virtual route.
 *  - POST /wp-json/geo-monitor/v1/llms-txt : backend pushes the generated llms.txt
 *    (authenticated via the Application Password used for provisioning).
 *  - GET  /llms.txt : serves the stored content at the site root for AI crawlers.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Geo_Rest {

    public function __construct() {
        add_action('rest_api_init', array($this, 'routes'));
        add_action('init', array($this, 'rewrite'));
        add_action('template_redirect', array($this, 'serve_llms'));
        add_filter('query_vars', function ($vars) {
            $vars[] = 'geo_llms';
            return $vars;
        });
    }

    public function routes() {
        register_rest_route('geo-monitor/v1', '/llms-txt', array(
            'methods'             => 'POST',
            'permission_callback' => function () {
                return current_user_can('manage_options');
            },
            'callback'            => function (WP_REST_Request $req) {
                $content = (string) $req->get_param('content');
                update_option('geo_monitor_llms_txt', $content, false);
                return array('ok' => true, 'bytes' => strlen($content));
            },
        ));
    }

    public function rewrite() {
        add_rewrite_rule('^llms\.txt$', 'index.php?geo_llms=1', 'top');
    }

    public function serve_llms() {
        if (intval(get_query_var('geo_llms')) !== 1) {
            return;
        }
        header('Content-Type: text/plain; charset=utf-8');
        echo (string) get_option('geo_monitor_llms_txt', "# llms.txt not generated yet\n");
        exit;
    }
}
