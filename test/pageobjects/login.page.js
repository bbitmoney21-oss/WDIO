class LoginPage {

get username(){
    return $('#customer_email')
}
get password(){
    return $('#customer_password')
}
get loginButton(){
    return $('.button')
}

get loginMessage(){
    return $('.page-title')
}
async login(username,password){
    await this.username.setValue(username);
    await this.password.setValue(password);
    await this.loginButton.click();
}
async checkLoginSuccess(message){
    await expect(this.loginMessage).toHaveText(message);
}
}
