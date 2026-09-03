package com.jodtungtung.ledger;

import android.Manifest;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

@CapacitorPlugin(
    name = "GalleryScan",
    permissions = {
        @Permission(alias = "photos", strings = { Manifest.permission.READ_MEDIA_IMAGES })
    }
)
public class GalleryScanPlugin extends Plugin {

    private boolean hasRequiredPermission() {
        String perm = Build.VERSION.SDK_INT >= 33
            ? Manifest.permission.READ_MEDIA_IMAGES
            : Manifest.permission.READ_EXTERNAL_STORAGE;
        return getContext().checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void checkPhotoPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", hasRequiredPermission());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPhotoPermission(PluginCall call) {
        if (hasRequiredPermission()) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("photos", call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", hasRequiredPermission());
        call.resolve(ret);
    }

    // Lists every distinct album (MediaStore "bucket") that has images, newest-active first.
    @PluginMethod
    public void listAlbums(PluginCall call) {
        if (!hasRequiredPermission()) {
            call.reject("PERMISSION_DENIED");
            return;
        }
        JSArray results = new JSArray();
        String[] projection = { MediaStore.Images.Media.BUCKET_DISPLAY_NAME };
        String sortOrder = MediaStore.Images.Media.DATE_ADDED + " DESC";
        LinkedHashSet<String> seen = new LinkedHashSet<>();

        try (Cursor cursor = getContext().getContentResolver().query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI, projection, null, null, sortOrder)) {
            if (cursor != null) {
                int nameCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.BUCKET_DISPLAY_NAME);
                while (cursor.moveToNext() && seen.size() < 150) {
                    String name = cursor.getString(nameCol);
                    if (name != null && seen.add(name)) {
                        JSObject item = new JSObject();
                        item.put("name", name);
                        results.put(item);
                    }
                }
            }
        } catch (Exception e) {
            call.reject("Failed to list albums: " + e.getMessage());
            return;
        }

        JSObject ret = new JSObject();
        ret.put("albums", results);
        call.resolve(ret);
    }

    // Returns images added after `since` (epoch millis), newest first, capped at `limit`.
    // If `album` is given, only images in that MediaStore bucket (folder) are returned.
    @PluginMethod
    public void getRecentImages(PluginCall call) {
        if (!hasRequiredPermission()) {
            call.reject("PERMISSION_DENIED");
            return;
        }
        long since = (long) call.getDouble("since", 0.0).doubleValue();
        int limit = call.getInt("limit", 20);
        String album = call.getString("album");

        JSArray results = new JSArray();
        String[] projection = {
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DATE_ADDED,
            MediaStore.Images.Media.DISPLAY_NAME
        };
        List<String> args = new ArrayList<>();
        args.add(String.valueOf(since / 1000L));
        String selection = MediaStore.Images.Media.DATE_ADDED + " > ?";
        if (album != null && !album.isEmpty()) {
            selection += " AND " + MediaStore.Images.Media.BUCKET_DISPLAY_NAME + " = ?";
            args.add(album);
        }
        String[] selectionArgs = args.toArray(new String[0]);
        String sortOrder = MediaStore.Images.Media.DATE_ADDED + " DESC";

        try (Cursor cursor = getContext().getContentResolver().query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                projection, selection, selectionArgs, sortOrder)) {
            if (cursor != null) {
                int idCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID);
                int dateCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED);
                int nameCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME);
                int count = 0;
                while (cursor.moveToNext() && count < limit) {
                    long id = cursor.getLong(idCol);
                    long dateAdded = cursor.getLong(dateCol) * 1000L;
                    String name = cursor.getString(nameCol);
                    Uri contentUri = Uri.withAppendedPath(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, String.valueOf(id));

                    JSObject item = new JSObject();
                    item.put("uri", contentUri.toString());
                    item.put("dateAdded", dateAdded);
                    item.put("displayName", name);
                    results.put(item);
                    count++;
                }
            }
        } catch (Exception e) {
            call.reject("Failed to query images: " + e.getMessage());
            return;
        }

        JSObject ret = new JSObject();
        ret.put("images", results);
        call.resolve(ret);
    }

    @PluginMethod
    public void readImageBase64(PluginCall call) {
        String uriString = call.getString("uri");
        if (uriString == null) {
            call.reject("Missing uri");
            return;
        }
        try {
            Uri uri = Uri.parse(uriString);
            InputStream is = getContext().getContentResolver().openInputStream(uri);
            if (is == null) {
                call.reject("Could not open image");
                return;
            }
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] data = new byte[16384];
            int nRead;
            while ((nRead = is.read(data, 0, data.length)) != -1) {
                buffer.write(data, 0, nRead);
            }
            is.close();
            String base64 = Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP);
            JSObject ret = new JSObject();
            ret.put("base64", base64);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to read image: " + e.getMessage());
        }
    }
}
