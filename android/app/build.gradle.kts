// "המשפחה שלנו" — אפליקציית אנדרואיד (Trusted Web Activity)
// פותחת את האפליקציה במסך מלא דרך מנוע Chrome, כולל התראות ועבודה ללא חיבור.
plugins {
    id("com.android.application")
}

val runNumber = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1

android {
    namespace = "com.eitan.ourfamily"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.eitan.ourfamily"
        minSdk = 24
        targetSdk = 35
        versionCode = runNumber
        versionName = "1.0.0"
    }

    signingConfigs {
        create("release") {
            storeFile = file("release.keystore")
            storePassword = System.getenv("KS_PASS")
            keyAlias = "ourfamily"
            keyPassword = System.getenv("KS_PASS")
            storeType = "pkcs12"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.5.0")
}
