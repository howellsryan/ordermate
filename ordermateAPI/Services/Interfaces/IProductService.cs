using ordermateAPI.Models;

namespace ordermateAPI.Services.Interfaces;

public interface IProductService
{
    Task<ProductModel> Get(int id);

    Task<List<ProductModel>> Get();

    Task<List<ProductModel>> GetByCategoryId(int categoryId);
}