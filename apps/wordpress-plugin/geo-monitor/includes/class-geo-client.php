<?php
/**
 * Thin HTTP client for the GEO backend v1 API. All authenticated calls send:
 *   X-Geo-Site:    this site's URL   (tenant external id)
 *   X-Geo-Api-Key: the provisioned key
 */

if (!defined('ABSPATH')) {
    exit;
}

class Geo_Client {

    private function base() {
        return rtrim(GEO_BACKEND_URL, '/');
    }

    private function headers() {
        return array(
            'Content-Type' => 'application/json',
            'X-Geo-Site'   => rtrim(get_site_url(), '/'),
            'X-Geo-Api-Key' => (string) get_option('geo_monitor_api_key', ''),
        );
    }

    /** One-time provisioning; not tenant-authenticated. */
    public function register($username, $app_password) {
        $resp = wp_remote_post($this->base() . '/api/onboard/wordpress', array(
            'timeout' => 20,
            'headers' => array('Content-Type' => 'application/json'),
            'body'    => wp_json_encode(array(
                'siteUrl'     => rtrim(get_site_url(), '/'),
                'username'    => $username,
                'appPassword' => $app_password,
            )),
        ));
        return $this->parse($resp);
    }

    public function get($path) {
        $resp = wp_remote_get($this->base() . $path, array(
            'timeout' => 30,
            'headers' => $this->headers(),
        ));
        return $this->parse($resp);
    }

    public function post($path, $body = array()) {
        $resp = wp_remote_post($this->base() . $path, array(
            'timeout' => 30,
            'headers' => $this->headers(),
            'body'    => wp_json_encode($body),
        ));
        return $this->parse($resp);
    }

    public function delete($path) {
        $resp = wp_remote_request($this->base() . $path, array(
            'method'  => 'DELETE',
            'timeout' => 30,
            'headers' => $this->headers(),
        ));
        return $this->parse($resp);
    }

    private function parse($resp) {
        if (is_wp_error($resp)) {
            return $resp;
        }
        $code = wp_remote_retrieve_response_code($resp);
        $body = json_decode(wp_remote_retrieve_body($resp), true);
        if ($code >= 400) {
            return new WP_Error('geo_api_error', isset($body['error']) ? $body['error'] : ('HTTP ' . $code), $body);
        }
        return $body;
    }
}
